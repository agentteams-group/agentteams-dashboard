// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

const CONNECTOR = 'http://connector.test:8088';
const CONTROLLER = 'http://controller.test';

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

function fetchUrls(): string[] {
  const mock = fetch as unknown as { mock: { calls: Array<[string, ...unknown[]]> } };
  return mock.mock.calls.map(([url]) => String(url));
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string[],
  query = '',
  body = '',
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', CONTROLLER);
  vi.stubEnv('AGENTTEAMS_MILLFORGE_URL', CONNECTOR);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  const route = await import('./route');
  const handler =
    method === 'GET' ? route.GET : method === 'PUT' ? route.PUT : route.POST;
  return handler(request(method, query, body) as never, {
    params: Promise.resolve({ path }),
  });
}

describe('/api/agentteams/millforge/[...path] (proxy → 工作台插件 connector)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('GET packs → connector /api/agentteams-proxy/millforge/packs', async () => {
    const res = await call('GET', ['packs']);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      `${CONNECTOR}/api/agentteams-proxy/millforge/packs`,
      expect.objectContaining({ method: 'GET' }),
    );
    // 核心端点不再打到 Controller
    expect(fetchUrls().every((url) => url.startsWith(CONNECTOR))).toBe(true);
  });

  it('GET packs/{pack}/file forwards the encoded pack and path query', async () => {
    await call('GET', ['packs', 'millforge-pack', 'file'], 'path=INDEX.yaml&controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      `${CONNECTOR}/api/agentteams-proxy/millforge/packs/millforge-pack/file?path=INDEX.yaml`,
      expect.anything(),
    );
  });

  it('GET source → connector source（不触发 Controller）', async () => {
    const res = await call('GET', ['source']);
    expect(res.status).toBe(200);
    expect(fetchUrls()).toEqual([`${CONNECTOR}/api/agentteams-proxy/millforge/source`]);
  });

  it('PUT source forwards the JSON body to the connector', async () => {
    const body = JSON.stringify({ kind: 'github', repo: 'LUOSENGWA/Millforge' });
    await call('PUT', ['source'], '', body);
    expect(fetch).toHaveBeenCalledWith(
      `${CONNECTOR}/api/agentteams-proxy/millforge/source`,
      expect.objectContaining({
        method: 'PUT',
        body,
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
  });

  it('POST compile forwards the JSON body to the connector', async () => {
    const body = JSON.stringify({ pack: 'p', team: 't', lang: 'zh' });
    await call('POST', ['compile'], '', body);
    expect(fetch).toHaveBeenCalledWith(
      `${CONNECTOR}/api/agentteams-proxy/millforge/compile`,
      expect.objectContaining({ method: 'POST', body }),
    );
  });

  it('POST inject → connector inject', async () => {
    await call('POST', ['inject'], '', '{"build_id":"b"}');
    const urls = fetchUrls();
    expect(urls).toEqual([`${CONNECTOR}/api/agentteams-proxy/millforge/inject`]);
    expect(fetch).toHaveBeenCalledWith(
      `${CONNECTOR}/api/agentteams-proxy/millforge/inject`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('POST inject/preflight and GET injections stay on the connector', async () => {
    await call('POST', ['inject', 'preflight'], '', '{"build_id":"b"}');
    expect(fetchUrls()).toEqual([`${CONNECTOR}/api/agentteams-proxy/millforge/inject/preflight`]);

    await call('GET', ['injections']);
    expect(fetchUrls()).toEqual([`${CONNECTOR}/api/agentteams-proxy/millforge/injections`]);
  });

  it('connector 不可达 → 503 明确文案（不伪装 404/405）', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', CONTROLLER);
    vi.stubEnv('AGENTTEAMS_MILLFORGE_URL', CONNECTOR);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const route = await import('./route');
    const res = await route.GET(request('GET', '') as never, {
      params: Promise.resolve({ path: ['source'] }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('工作台插件 connector 不可达（AGENTTEAMS_MILLFORGE_URL）');
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

  it('passes upstream 404 through unchanged', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', CONTROLLER);
    vi.stubEnv('AGENTTEAMS_MILLFORGE_URL', CONNECTOR);
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

describe('模块更新面仍走 Controller', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('GET millforge/index → Controller，不打 connector', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', CONTROLLER);
    vi.stubEnv('AGENTTEAMS_MILLFORGE_URL', CONNECTOR);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ modules: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const indexRoute = await import('../index/route');
    const res = await indexRoute.GET(request('GET', 'source=github&channel=beta') as never);
    expect(res.status).toBe(200);
    const urls = fetchUrls();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith(CONTROLLER))).toBe(true);
    expect(urls[0]).toBe(`${CONTROLLER}/api/v1/millforge/index?source=github&channel=beta`);
  });
});
