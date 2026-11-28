// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  NACOS_ARTIFACT_MAX_BYTES,
  NACOS_ZIP_MAX_ENTRIES,
  fetchNacosSkillZip,
  sanitizeNacosText,
  unzipNacosArtifact,
} from './nacos-fetcher';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));
vi.mock('@/lib/skill-center-config', () => ({ getNacosConfig: vi.fn() }));

const TOKEN = 'sec ret/+?&=token-xyz';
const ENCODED_TOKEN = encodeURIComponent(TOKEN);
const config = {
  registryUrl: 'nacos://nacos.example.com:8848/public',
  protocol: 'https' as const,
  mode: 'services' as const,
  namespace: 'public',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serviceList(homePageUrl: string): Response {
  return json({ code: 200, data: { serviceList: [{ name: 'demo', homePageUrl }] } });
}

function skillZip(name = 'demo'): Uint8Array {
  return zipSync({
    'SKILL.md': new TextEncoder().encode(`---\nname: ${name}\ndescription: demo\n---\n`),
    'scripts/run.sh': new TextEncoder().encode('echo ok'),
  });
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => vi.unstubAllGlobals());

describe('Nacos request credential hygiene (SEC-04)', () => {
  it('uses Bearer, never query tokens, and redacts 500 bodies in raw and encoded forms', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ accessToken: TOKEN }))
      .mockResolvedValueOnce(new Response(`${TOKEN} ${ENCODED_TOKEN} ?accessToken=${ENCODED_TOKEN}`, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    let message = '';
    try { await fetchNacosSkillZip('demo', { ...config, username: 'u', password: 'p' }); } catch (err) { message = String(err); }
    const request = fetchMock.mock.calls[1];
    expect(String(request[0])).not.toContain('accessToken');
    expect(new Headers(request[1].headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(ENCODED_TOKEN);
    expect(message).not.toContain(encodeURIComponent(ENCODED_TOKEN));
  });

  it.each(['invalid-json', 'timeout'] as const)('does not leak tokens on %s failures', async (failure) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ accessToken: TOKEN }))
      .mockImplementationOnce(async () => {
        if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
        return new Response(TOKEN, { status: 200 });
      });
    vi.stubGlobal('fetch', fetchMock);
    let message = '';
    try { await fetchNacosSkillZip('demo', { ...config, username: 'u', password: 'p' }); } catch (err) { message = String(err); }
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(ENCODED_TOKEN);
  });

  it('scrubs standalone, query, Bearer and repeatedly encoded secret forms', () => {
    const input = `${TOKEN} ${ENCODED_TOKEN} ${encodeURIComponent(ENCODED_TOKEN)} Bearer ${TOKEN} ?accessToken=${ENCODED_TOKEN}`;
    const output = sanitizeNacosText(input, [TOKEN]);
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(ENCODED_TOKEN);
    expect(output).not.toContain(encodeURIComponent(ENCODED_TOKEN));
    expect(output).toContain('[REDACTED]');
  });
});

describe('Nacos artifact SSRF and streaming bounds (SEC-07)', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/artifact.zip',
    'https://metadata.google.internal/artifact.zip',
    'https://evil.example/artifact.zip',
  ])('blocks disallowed artifact target %s before artifact fetch', async (target) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(serviceList(target));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNacosSkillZip('demo', config)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('revalidates redirects and never follows an artifact redirect to metadata', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serviceList('https://github.com/org/repo/archive/main.zip'))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNacosSkillZip('demo', config)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('169.254.169.254'))).toBe(false);
  });

  it('allows GitHub to redirect only to the allowlisted public codeload host', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serviceList('https://github.com/org/repo/archive/main.zip'))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/org/repo/zip/main' } }))
      .mockResolvedValueOnce(new Response(skillZip().buffer as ArrayBuffer, { headers: { 'content-type': 'application/zip' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchNacosSkillZip('demo', config);
    expect(result.source).toBe('homePageUrl');
    expect(unzipNacosArtifact(result.zipBytes)['SKILL.md']).toBeDefined();
    expect(String(fetchMock.mock.calls[2][0])).toContain('codeload.github.com');
  });

  it('rejects an oversized Content-Length before reading the body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serviceList('https://github.com/org/repo/archive/main.zip'))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]).buffer, {
        headers: { 'content-length': String(NACOS_ARTIFACT_MAX_BYTES + 1) },
      }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNacosSkillZip('demo', config)).rejects.toThrow(/64MB/);
  });

  it('enforces the actual streamed byte count when Content-Length is absent', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 65; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serviceList('https://github.com/org/repo/archive/main.zip'))
      .mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/zip' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNacosSkillZip('demo', config)).rejects.toThrow(/64MB/);
  });
});

describe('Nacos ZIP expansion bounds (SEC-07)', () => {
  it('rejects traversal, absolute, backslash and NUL member names', () => {
    for (const name of ['../evil', '/absolute', 'dir\\evil', 'bad\0name']) {
      expect(() => unzipNacosArtifact(zipSync({ [name]: new Uint8Array([1]) }))).toThrow();
    }
  });

  it('rejects zip bombs by compression ratio before extraction', () => {
    const bomb = zipSync({ 'bomb.txt': new Uint8Array(1024 * 1024) });
    expect(() => unzipNacosArtifact(bomb)).toThrow(/压缩比/);
  });

  it('rejects archives with too many members', () => {
    const entries = Object.fromEntries(Array.from({ length: NACOS_ZIP_MAX_ENTRIES + 1 }, (_, i) => [`${i}.txt`, new Uint8Array()]));
    expect(() => unzipNacosArtifact(zipSync(entries))).toThrow(/成员数/);
  });

  it('rejects oversized single files and total expansion using central-directory limits', () => {
    const zip = zipSync({ 'a.txt': new Uint8Array([1]), 'b.txt': new Uint8Array([1]) });
    const bytes = new Uint8Array(zip);
    const view = new DataView(bytes.buffer);
    const patched: number[] = [];
    for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 20, 17 * 1024 * 1024, true);
        view.setUint32(offset + 24, 17 * 1024 * 1024, true);
        const local = view.getUint32(offset + 42, true);
        view.setUint32(local + 22, 17 * 1024 * 1024, true);
        patched.push(offset);
      }
    }
    expect(patched).toHaveLength(2);
    expect(() => unzipNacosArtifact(bytes)).toThrow(/单文件/);
  });

  it('rejects total expansion above 128MB even when each member is under 16MB', () => {
    const entries = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`${i}.txt`, new Uint8Array([1])]));
    const zip = zipSync(entries);
    const bytes = new Uint8Array(zip);
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      view.setUint32(offset + 20, 16 * 1024 * 1024, true);
      view.setUint32(offset + 24, 16 * 1024 * 1024, true);
      const local = view.getUint32(offset + 42, true);
      view.setUint32(local + 18, 16 * 1024 * 1024, true);
      view.setUint32(local + 22, 16 * 1024 * 1024, true);
    }
    expect(() => unzipNacosArtifact(bytes)).toThrow(/总大小/);
  });
});
