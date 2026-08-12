// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEntryUrl, hashString, fetchManifestJson } from './loader';

describe('resolveEntryUrl', () => {
  it('resolves a relative entry against the manifest URL', () => {
    expect(resolveEntryUrl('http://host/plugins/x/plugin.json', 'index.js')).toBe(
      'http://host/plugins/x/index.js'
    );
  });
  it('resolves a nested relative entry', () => {
    expect(resolveEntryUrl('http://host/plugin.json', 'src/main.jsx')).toBe(
      'http://host/src/main.jsx'
    );
  });
  it('keeps an absolute entry URL as-is', () => {
    expect(resolveEntryUrl('http://host/plugin.json', 'https://cdn/x.js')).toBe('https://cdn/x.js');
  });
  it('resolves a same-origin relative manifest URL against the current origin', () => {
    // In node (no window) the origin falls back to http://localhost.
    expect(resolveEntryUrl('/plugins/demo/plugin.json', 'index.js')).toBe(
      'http://localhost/plugins/demo/index.js'
    );
  });
});

describe('hashString', () => {
  it('produces stable hashes for identical input', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
  });
  it('differs for different input', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
  it('handles empty string', () => {
    expect(typeof hashString('')).toBe('string');
  });
});

describe('fetchManifestJson', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
    );
    const result = await fetchManifestJson('http://host/plugin.json');
    expect(result).toEqual({ id: 'x' });
  });

  it('throws on non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(fetchManifestJson('http://host/plugin.json')).rejects.toThrow(/404/);
  });
});
