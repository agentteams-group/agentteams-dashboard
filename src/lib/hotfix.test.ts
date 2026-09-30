import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyHotfix,
  selectHotfixAssets,
  sha256File,
  HOTFIX_MAX_BYTES,
} from './hotfix';
import { compareSemver } from './version';

describe('selectHotfixAssets', () => {
  it('picks the tarball and checksum by prefix', () => {
    const release = {
      tag_name: 'v1.2.5',
      assets: [
        { name: 'dashboard-hotfix-v1.2.5.tar.gz', browser_download_url: 'https://x/t.tar.gz' },
        { name: 'dashboard-hotfix-v1.2.5.tar.gz.sha256', browser_download_url: 'https://x/t.sha256' },
        { name: 'source.zip', browser_download_url: 'https://x/src.zip' },
      ],
    };
    expect(selectHotfixAssets(release)).toEqual({
      tag: 'v1.2.5',
      tarUrl: 'https://x/t.tar.gz',
      sha256Url: 'https://x/t.sha256',
    });
  });

  it('returns null when the release has no hotfix bundle', () => {
    expect(selectHotfixAssets({ tag_name: 'v1.2.5', assets: [{ name: 'src.zip' }] })).toBeNull();
    expect(selectHotfixAssets({})).toBeNull();
  });
});

describe('sha256File', () => {
  it('hashes file content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hotfix-test-'));
    try {
      const file = join(dir, 'a.txt');
      writeFileSync(file, 'hello hotfix');
      const { createHash } = await import('node:crypto');
      const expected = createHash('sha256').update('hello hotfix').digest('hex');
      expect(await sha256File(file)).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('applyHotfix', () => {
  let workRoot: string;
  let appDir: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'hotfix-app-test-'));
    appDir = join(workRoot, 'app');
    // Simulate the running app directory.
    mkdirSync(join(appDir, '.next'), { recursive: true });
    writeFileSync(join(appDir, 'server.js'), 'old server');
    writeFileSync(join(appDir, '.next', 'BUILD_ID'), 'old-build\n');
  });

  afterEach(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  function makeBundle(tag: string): { tarUrl: string; sha256Url: string } {
    // Stage a "new build" and pack it with real tar — full-fidelity fixture.
    const stage = join(workRoot, `stage-${tag}`);
    mkdirSync(join(stage, '.next'), { recursive: true });
    writeFileSync(join(stage, 'server.js'), 'new server');
    writeFileSync(join(stage, '.next', 'BUILD_ID'), `${tag}-build\n`);

    const tarPath = join(workRoot, `dashboard-hotfix-${tag}.tar.gz`);
    execFileSync('tar', ['-czf', tarPath, '-C', stage, '.']);
    const shaPath = `${tarPath}.sha256`;
    const hash = createHash('sha256').update(execFileSync('cat', [tarPath])).digest('hex');
    writeFileSync(shaPath, `${hash}  dashboard-hotfix-${tag}.tar.gz\n`);
    return { tarUrl: tarPath, sha256Url: shaPath };
  }
  it('downloads, verifies, and hot-swaps the app directory', async () => {
    const bundle = makeBundle('v9');
    // fetchImpl reads local fixture files instead of the network.
    const { readFile } = await import('node:fs/promises');
    const fetchImpl = (async (url: string | URL) => {
      const body = await readFile(String(url));
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    const result = await applyHotfix({
      release: { tag: 'v9.0.0', tarUrl: bundle.tarUrl, sha256Url: bundle.sha256Url },
      appDir,
      workRoot,
      fetchImpl,
    });

    expect(result.version).toBe('v9.0.0');
    expect(result.buildId).toBe('v9-build');
    expect(existsSync(join(appDir, 'server.js'))).toBe(true);
    const { readFile: readNew } = await import('node:fs/promises');
    expect((await readNew(join(appDir, 'server.js'), 'utf8')).startsWith('new server')).toBe(true);
    // Previous build kept as <appDir>.prev for rollback.
    expect(existsSync(`${appDir}.prev/server.js`)).toBe(true);
  });

  it('aborts and leaves the running build untouched on a checksum mismatch', async () => {
    const bundle = makeBundle('v9');
    const { writeFileSync: rewrite } = await import('node:fs');
    rewrite(bundle.sha256Url, `${'0'.repeat(64)}  nope\n`);

    const { readFile } = await import('node:fs/promises');
    const fetchImpl = (async (url: string | URL) => {
      return new Response(await readFile(String(url)), { status: 200 });
    }) as typeof fetch;

    await expect(
      applyHotfix({
        release: { tag: 'v9.0.0', tarUrl: bundle.tarUrl, sha256Url: bundle.sha256Url },
        appDir,
        workRoot,
        fetchImpl,
      })
    ).rejects.toThrow('sha256 不匹配');

    expect((await readFile(join(appDir, 'server.js'), 'utf8')).startsWith('old server')).toBe(true);
  });

  it('rolls the old build back when the swap fails mid-way', async () => {
    // A bundle without BUILD_ID fails the sanity check AFTER extraction.
    const badStage = join(workRoot, 'bad-stage');
    mkdirSync(badStage, { recursive: true });
    writeFileSync(join(badStage, 'server.js'), 'bad server');
    const tarPath = join(workRoot, 'bad.tar.gz');
    execFileSync('tar', ['-czf', tarPath, '-C', badStage, '.']);

    const { readFile } = await import('node:fs/promises');
    const fetchImpl = (async (url: string | URL) => {
      return new Response(await readFile(String(url)), { status: 200 });
    }) as typeof fetch;

    await expect(
      applyHotfix({
        release: { tag: 'v9.0.0', tarUrl: tarPath, sha256Url: null },
        appDir,
        workRoot,
        fetchImpl,
      })
    ).rejects.toThrow();

    expect((await readFile(join(appDir, 'server.js'), 'utf8')).startsWith('old server')).toBe(true);
    expect(existsSync(`${appDir}.prev`)).toBe(false);
  });

  it('exposes the size cap constant for download enforcement', () => {
    expect(HOTFIX_MAX_BYTES).toBeGreaterThan(0);
  });
});

describe('compareSemver (shared lib)', () => {
  it('orders versions for the hot-patch gate', () => {
    expect(compareSemver('v1.2.5', '1.2.4.9')).toBeGreaterThan(0);
    expect(compareSemver('v1.2.5', '1.2.5')).toBe(0);
  });
});
