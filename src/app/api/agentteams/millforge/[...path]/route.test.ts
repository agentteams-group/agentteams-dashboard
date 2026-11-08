// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

function request(
  method: string,
  query = '',
  body = '',
): {
  method: string;
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: Headers;
  text: () => Promise<string>;
} {
  return {
    method,
    nextUrl: {
      pathname: '/api/agentteams/millforge',
      searchParams: new URLSearchParams(query),
    },
    headers: new Headers(),
    text: async () => body,
  };
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string[],
  query = '',
  body = '',
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  const route = await import('./route');
  const handler =
    method === 'GET' ? route.GET : method === 'PUT' ? route.PUT : route.POST;
  return handler(request(method, query, body) as never, {
    params: Promise.resolve({ path }),
  });
}

describe('/api/agentteams/millforge/[...path] (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('GET packs → controller /api/v1/millforge/packs', async () => {
    const res = await call('GET', ['packs']);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/millforge/packs',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('GET packs/{pack}/file forwards the encoded pack and path query', async () => {
    await call('GET', ['packs', 'millforge-pack', 'file'], 'path=INDEX.yaml&controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/millforge/packs/millforge-pack/file?path=INDEX.yaml',
      expect.anything(),
    );
  });

  it('POST compile forwards the JSON body', async () => {
    const body = JSON.stringify({ pack: 'p', team: 't', lang: 'zh' });
    await call('POST', ['compile'], '', body);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/millforge/compile',
      expect.objectContaining({ method: 'POST', body }),
    );
  });

  it('POST inject → controller inject', async () => {
    await call('POST', ['inject'], '', '{"build_id":"b"}');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/millforge/inject',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('PUT source → controller source', async () => {
    await call('PUT', ['source'], '', '{"kind":"github"}');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/millforge/source',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('rejects methods/paths outside the whitelist', async () => {
    const res = await call('GET', ['inject']);
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-slug pack segment (path traversal)', async () => {
    const res = await call('GET', ['packs', '..', 'file'], 'path=INDEX.yaml');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes upstream 404 through (old controller has no millforge routes)', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );
    const route = await import('./route');
    const res = await route.GET(request('GET', '') as never, {
      params: Promise.resolve({ path: ['source'] }),
    });
    expect(res.status).toBe(404);
  });
});
