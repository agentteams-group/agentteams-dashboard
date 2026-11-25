import { describe, expect, it } from 'vitest';
import {
  FileEtagCache,
  concatChunks,
  decideDownloadResponse,
  parseContentRange,
  resumeHeaders,
  shouldPresign,
  uploadPercent,
} from '@/lib/files-transfer';
import { humanFilesApi } from '@/lib/human-files-api';

describe('Content-Range / 下载分支', () => {
  it('解析 bytes start-end/total', () => {
    expect(parseContentRange('bytes 100-199/2000')).toEqual({ start: 100, end: 199, total: 2000 });
    expect(parseContentRange('bytes 0-3/*')).toEqual({ start: 0, end: 3, total: null });
    expect(parseContentRange('garbage')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });

  it('304 → 复用缓存；206 起点一致 → append；416 → 重启', () => {
    expect(
      decideDownloadResponse({ status: 304, hasCache: true, received: 0 }).kind,
    ).toBe('reuse-cache');
    expect(
      decideDownloadResponse({
        status: 206,
        hasCache: false,
        received: 4,
        contentRange: 'bytes 4-9/10',
      }).kind,
    ).toBe('append');
    expect(
      decideDownloadResponse({
        status: 206,
        hasCache: false,
        received: 7,
        contentRange: 'bytes 4-9/10',
      }).kind,
    ).toBe('restart');
    expect(decideDownloadResponse({ status: 416, hasCache: false, received: 9 }).kind).toBe('restart');
    expect(decideDownloadResponse({ status: 200, hasCache: false, received: 0 }).kind).toBe('full');
  });

  it('续传头带 Range 与 If-Range', () => {
    expect(resumeHeaders(10, 'e1')).toEqual({ Range: 'bytes=10-', 'If-Range': 'e1' });
    expect(resumeHeaders(10, null)).toEqual({ Range: 'bytes=10-' });
  });

  it('大文件预签名门槛 / 分片拼接 / 上传百分比', () => {
    expect(shouldPresign(8 * 1024 * 1024 - 1)).toBe(false);
    expect(shouldPresign(8 * 1024 * 1024)).toBe(true);
    expect(uploadPercent(50, 200)).toBe(25);
    expect(uploadPercent(0, 0)).toBeNull();
    const blob = concatChunks([new Uint8Array([1, 2]), new Uint8Array([3])]);
    expect(blob.size).toBe(3);
  });
});

describe('ETag 缓存', () => {
  it('LRU 上限与空 etag 不入缓存', () => {
    const cache = new FileEtagCache(2);
    cache.set('a', { blob: new Blob(['a']), etag: 'e1' });
    cache.set('b', { blob: new Blob(['b']), etag: 'e2' });
    cache.get('a');
    cache.set('c', { blob: new Blob(['c']), etag: 'e3' });
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    cache.set('d', { blob: new Blob(['d']), etag: '' });
    expect(cache.get('d')).toBeUndefined();
  });
});

describe('humanFilesApi.download 304 / 206', () => {
  it('第二次命中 ETag → 304 复用本地 Blob', async () => {
    const calls: RequestInit[] = [];
    let n = 0;
    const fetchMock = async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      n += 1;
      if (n === 1) {
        return new Response('hello', { status: 200, headers: { etag: '"v1"' } });
      }
      return new Response(null, { status: 304 });
    };
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const first = await humanFilesApi.download('alice', 'a.txt');
      expect(await first.text()).toBe('hello');
      const second = await humanFilesApi.download('alice', 'a.txt');
      expect(await second.text()).toBe('hello');
      const headers = (calls[1].headers ?? {}) as Record<string, string>;
      expect(headers['If-None-Match']).toBe('"v1"');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('206 分片响应按 Content-Range 起点 0 拼装', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('abcd', {
        status: 206,
        headers: { 'content-range': 'bytes 0-3/4', etag: '"v2"' },
      })) as unknown as typeof fetch;
    try {
      const blob = await humanFilesApi.download('bob', 'b.bin');
      expect(blob.size).toBe(4);
    } finally {
      globalThis.fetch = original;
    }
  });
});
