import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyHotfix,
  downloadTo,
  HOTFIX_MAX_BYTES,
  inspectTar,
  selectHotfixAssets,
  sha256File,
} from './hotfix';
import { compareSemver } from './version';

interface TarEntry {
  name: string;
  data?: string;
  type?: '0' | '5' | '1' | '2' | 'x' | 'L';
  linkname?: string;
}

/** Small deterministic ustar fixture, including unsafe member metadata. */
function makeTar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    const data = Buffer.from(entry.data ?? '');
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? '0').charCodeAt(0);
    header.write(entry.linkname ?? '', 157, 100, 'utf8');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function makePax(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => {
    const body = ` ${key}=${value}\n`;
    let length = body.length + 1;
    while (String(length).length + body.length !== length) length = String(length).length + body.length;
    return `${length}${body}`;
  }).join('');
}

function bundleEntries(buildId: string): TarEntry[] {
  return [
    { name: './', type: '5' },
    { name: './.next/', type: '5' },
    { name: './server.js', data: `server ${buildId}` },
    { name: './.next/BUILD_ID', data: `${buildId}\n` },
  ];
}

function localFetch(files: Record<string, Buffer | string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const value = files[url];
    if (value === undefined) return new Response('missing', { status: 404 });
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-length': String(bytes.length) },
    });
  }) as typeof fetch;
}

describe('selectHotfixAssets', () => {
  it('requires both tarball and checksum assets', () => {
    const tar = { name: 'dashboard-hotfix-v1.2.5.tar.gz', browser_download_url: 'https://x/t.tar.gz' };
    const sha = { name: 'dashboard-hotfix-v1.2.5.tar.gz.sha256', browser_download_url: 'https://x/t.sha256' };
    expect(selectHotfixAssets({ tag_name: 'v1.2.5', assets: [tar, sha, { name: 'source.zip' }] })).toEqual({
      tag: 'v1.2.5', tarUrl: 'https://x/t.tar.gz', sha256Url: 'https://x/t.sha256',
    });
    expect(selectHotfixAssets({ tag_name: 'v1.2.5', assets: [tar] })).toBeNull();
    expect(selectHotfixAssets({})).toBeNull();
  });
});

describe('sha256File', () => {
  it('hashes file content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hotfix-test-'));
    try {
      const file = join(dir, 'a.txt');
      writeFileSync(file, 'hello hotfix');
      expect(await sha256File(file)).toBe(createHash('sha256').update('hello hotfix').digest('hex'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('downloadTo limits', () => {
  let directory: string;

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'hotfix-download-')); });
  afterEach(() => { vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); });

  it('rejects a declared oversized response and an oversized streamed body', async () => {
    const destination = join(directory, 'bundle.tar.gz');
    const declared = (async () => new Response('12345', { headers: { 'content-length': '5' } })) as typeof fetch;
    await expect(downloadTo('https://x/bundle', destination, 4, { fetchImpl: declared })).rejects.toThrow('超出大小上限');
    const streamed = (async () => new Response('12345')) as typeof fetch;
    await expect(downloadTo('https://x/bundle', destination, 4, { fetchImpl: streamed })).rejects.toThrow('超出大小上限');
    expect(existsSync(destination)).toBe(false);
  });

  it('aborts at the total timeout without issuing a real process signal', async () => {
    vi.useFakeTimers();
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    const pending = downloadTo('https://x/bundle', join(directory, 'bundle'), 10, {
      fetchImpl: fetchImpl, totalTimeoutMs: 100,
    });
    const assertion = expect(pending).rejects.toThrow('总超时');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('aborts when a response body goes idle', async () => {
    vi.useFakeTimers();
    const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
    }))) as typeof fetch;
    const pending = downloadTo('https://x/bundle', join(directory, 'bundle'), 10, {
      fetchImpl, idleTimeoutMs: 50,
    });
    const assertion = expect(pending).rejects.toThrow('空闲超时');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});

describe('tar preflight', () => {
  let directory: string;

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'hotfix-tar-')); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it.each([
    ['path traversal', { name: '../escape', data: 'bad' }],
    ['absolute path', { name: '/escape', data: 'bad' }],
    ['Windows host path', { name: 'C:/escape', data: 'bad' }],
    ['backslash traversal', { name: '..\\escape', data: 'bad' }],
    ['escaping symlink', { name: 'link', type: '2', linkname: '../../escape' }],
    ['absolute symlink', { name: 'link', type: '2', linkname: '/etc/passwd' }],
    ['Windows symlink', { name: 'link', type: '2', linkname: 'C:/Windows' }],
    ['invalid hardlink', { name: 'hard', type: '1', linkname: '../outside' }],
    ['special file', { name: 'device', type: '3' }],
  ])('rejects %s before extraction', async (_label, unsafe) => {
    const tarPath = join(directory, 'unsafe.tar.gz');
    writeFileSync(tarPath, makeTar([unsafe as TarEntry]));
    await expect(inspectTar(tarPath)).rejects.toThrow('热更新');
    expect(existsSync(join(directory, 'escape'))).toBe(false);
  });

  it('rejects unsafe paths hidden in PAX and GNU long-name metadata', async () => {
    for (const entries of [
      [
        { name: 'PaxHeader', type: 'x', data: makePax({ path: '../escape' }) },
        { name: 'safe', data: 'x' },
      ],
      [
        { name: '././@LongLink', type: 'L', data: '../escape\0' },
        { name: 'safe', data: 'x' },
      ],
    ]) {
      const tarPath = join(directory, 'metadata.tar.gz');
      writeFileSync(tarPath, makeTar(entries as TarEntry[]));
      await expect(inspectTar(tarPath)).rejects.toThrow('热更新');
    }
  });

  it('accepts safe multi-block long-name metadata', async () => {
    const longName = `${'a'.repeat(600)}/file`;
    const tarPath = join(directory, 'long-name.tar.gz');
    writeFileSync(tarPath, makeTar([
      { name: '././@LongLink', type: 'L', data: `${longName}\0` },
      { name: 'truncated', data: 'safe' },
    ]));
    expect((await inspectTar(tarPath)).members[0].name).toBe(longName);
  });

  it('allows links whose targets stay inside the bundle', async () => {
    const tarPath = join(directory, 'safe.tar.gz');
    writeFileSync(tarPath, makeTar([
      { name: 'dir/file', data: 'safe' },
      { name: 'dir/link', type: '2', linkname: 'file' },
      { name: 'hard', type: '1', linkname: 'dir/file' },
    ]));
    const manifest = await inspectTar(tarPath);
    expect(manifest.members).toHaveLength(3);
    expect(manifest.expandedBytes).toBe(4);
  });
});

describe('applyHotfix', () => {
  let workRoot: string;
  let dataRoot: string;
  const disk = { bavail: 10_000_000, bsize: 1024 };

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'hotfix-app-test-'));
    dataRoot = join(workRoot, 'data');
    mkdirSync(join(dataRoot, 'versions', 'old-build'), { recursive: true });
    writeFileSync(join(dataRoot, 'versions', 'old-build', 'server.js'), 'old server');
    writeFileSync(join(dataRoot, 'current'), 'old-build\n');
  });

  afterEach(() => rmSync(workRoot, { recursive: true, force: true }));

  function makeBundle(buildId: string) {
    const tar = makeTar(bundleEntries(buildId));
    const hash = createHash('sha256').update(tar).digest('hex');
    return {
      tar,
      files: {
        'https://x/hotfix.tar.gz': tar,
        'https://x/hotfix.tar.gz.sha256': `${hash}  dashboard-hotfix.tar.gz\n`,
      },
    };
  }

  function apply(files: Record<string, Buffer | string>, statfsImpl = vi.fn().mockResolvedValue(disk)) {
    return applyHotfix({
      release: { tag: 'v9.0.0', tarUrl: 'https://x/hotfix.tar.gz', sha256Url: 'https://x/hotfix.tar.gz.sha256' },
      dataRoot,
      fetchImpl: localFetch(files),
      statfsImpl,
      workRoot: join(workRoot, 'download'),
    });
  }

  it('publishes versions/<buildId> via an atomic current file and retains the old build', async () => {
    const first = makeBundle('new-build');
    await expect(apply(first.files)).resolves.toEqual({
      version: 'v9.0.0', buildId: 'new-build', previousBuildId: 'old-build',
    });
    expect((await readFileSync(join(dataRoot, 'current'), 'utf8')).trim()).toBe('new-build');
    expect(readFileSync(join(dataRoot, 'versions', 'new-build', 'server.js'), 'utf8')).toBe('server new-build');
    expect(readFileSync(join(dataRoot, 'versions', 'old-build', 'server.js'), 'utf8')).toBe('old server');

    const second = makeBundle('newer-build');
    await expect(apply(second.files)).resolves.toMatchObject({ previousBuildId: 'new-build' });
    expect(existsSync(join(dataRoot, 'versions', 'new-build', 'server.js'))).toBe(true);
    expect(existsSync(join(dataRoot, 'versions', 'old-build', 'server.js'))).toBe(true);
  });

  it('extracts a real GNU tar fixture without passing Windows drive paths to tar', async () => {
    const stage = join(workRoot, 'gnu-stage');
    mkdirSync(join(stage, '.next'), { recursive: true });
    writeFileSync(join(stage, 'server.js'), 'gnu server');
    writeFileSync(join(stage, '.next', 'BUILD_ID'), 'gnu-build\n');
    // Both -C and the output are relative: C:\\... means "host:path" to GNU tar.
    execFileSync('tar', ['-czf', 'gnu.tar.gz', '-C', 'gnu-stage', '.'], { cwd: workRoot });
    const tar = readFileSync(join(workRoot, 'gnu.tar.gz'));
    const hash = createHash('sha256').update(tar).digest('hex');
    await expect(apply({
      'https://x/hotfix.tar.gz': tar,
      'https://x/hotfix.tar.gz.sha256': `${hash}\n`,
    })).resolves.toMatchObject({ buildId: 'gnu-build' });
    expect(readFileSync(join(dataRoot, 'versions', 'gnu-build', 'server.js'), 'utf8')).toBe('gnu server');
  });

  it('rejects a missing checksum before downloading', async () => {
    await expect(applyHotfix({
      release: { tag: 'v9.0.0', tarUrl: 'https://x/tar', sha256Url: '' },
      dataRoot,
      fetchImpl: vi.fn() as typeof fetch,
    })).rejects.toThrow('缺少 sha256');
  });

  it('leaves current untouched for corrupt or malformed checksums', async () => {
    const bundle = makeBundle('new-build');
    bundle.files['https://x/hotfix.tar.gz.sha256'] = `${'0'.repeat(64)}  bundle\n`;
    await expect(apply(bundle.files)).rejects.toThrow('sha256 不匹配');
    expect((await readFileSync(join(dataRoot, 'current'), 'utf8')).trim()).toBe('old-build');

    bundle.files['https://x/hotfix.tar.gz.sha256'] = 'not-a-checksum\n';
    await expect(apply(bundle.files)).rejects.toThrow('格式无效');
    expect(existsSync(join(dataRoot, 'versions', 'new-build'))).toBe(false);
  });

  it('rejects an oversized download before extraction and leaves current untouched', async () => {
    const bundle = makeBundle('new-build');
    const fixtureFetch = localFetch(bundle.files);
    const fetchImpl = (async (input: string | URL | Request) => {
      const response = await fixtureFetch(input);
      if (String(input) === 'https://x/hotfix.tar.gz') {
        return new Response(response.body, { status: 200, headers: { 'content-length': String(HOTFIX_MAX_BYTES + 1) } });
      }
      return response;
    }) as typeof fetch;
    await expect(applyHotfix({
      release: { tag: 'v9.0.0', tarUrl: 'https://x/hotfix.tar.gz', sha256Url: 'https://x/hotfix.tar.gz.sha256' },
      dataRoot, fetchImpl, statfsImpl: vi.fn().mockResolvedValue(disk), workRoot: join(workRoot, 'download'),
    })).rejects.toThrow('超出大小上限');
    expect((await readFileSync(join(dataRoot, 'current'), 'utf8')).trim()).toBe('old-build');
    expect(existsSync(join(dataRoot, 'versions', 'new-build'))).toBe(false);
  });

  it('leaves current untouched for unsafe tar members', async () => {
    const tar = makeTar([{ name: '../escape', data: 'bad' }]);
    const hash = createHash('sha256').update(tar).digest('hex');
    await expect(apply({
      'https://x/hotfix.tar.gz': tar,
      'https://x/hotfix.tar.gz.sha256': `${hash}\n`,
    })).rejects.toThrow('路径穿越');
    expect((await readFileSync(join(dataRoot, 'current'), 'utf8')).trim()).toBe('old-build');
    expect(existsSync(join(workRoot, 'escape'))).toBe(false);
  });

  it('aborts before download when disk space is insufficient', async () => {
    const bundle = makeBundle('new-build');
    const statfsImpl = vi.fn().mockResolvedValue({ bavail: 1, bsize: 1 });
    await expect(apply(bundle.files, statfsImpl)).rejects.toThrow('磁盘空间不足');
    expect(statfsImpl).toHaveBeenCalledTimes(1);
    expect((await readFileSync(join(dataRoot, 'current'), 'utf8')).trim()).toBe('old-build');
  });

  it('also checks expanded size against free space before extraction', async () => {
    const bundle = makeBundle('new-build');
    const statfsImpl = vi.fn().mockImplementation(async (path: string) => (
      path.includes('.hotfix-staging-') ? { bavail: 1, bsize: 1 } : disk
    ));
    await expect(apply(bundle.files, statfsImpl)).rejects.toThrow('磁盘空间不足');
    expect(statfsImpl.mock.calls.some(([path]) => String(path).includes('.hotfix-staging-'))).toBe(true);
    expect(existsSync(join(dataRoot, 'versions', 'new-build'))).toBe(false);
  });

  it('rejects invalid build ids instead of using them as directory names', async () => {
    const bundle = makeBundle('../escape');
    await expect(apply(bundle.files)).rejects.toThrow('BUILD_ID 无效');
    expect((await readFileSync(join(dataRoot, 'current'), 'utf8')).trim()).toBe('old-build');
  });

  it('keeps the byte cap available to callers', () => {
    expect(HOTFIX_MAX_BYTES).toBe(800 * 1024 * 1024);
  });
});

describe('compareSemver (shared lib)', () => {
  it('orders versions for the hot-patch gate', () => {
    expect(compareSemver('v1.2.5', '1.2.4.9')).toBeGreaterThan(0);
    expect(compareSemver('v1.2.5', '1.2.5')).toBe(0);
  });
});
