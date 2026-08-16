// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(
  name: string,
  sub: string,
  controllerStatus: number,
  controllerBody: unknown,
  query = '',
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(controllerBody), { status: controllerStatus }),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/workers/${name}/checkpoints/${sub}`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ name, sub }) },
  );
  return response;
}

describe('GET /api/agentteams/workers/[name]/checkpoints/[sub] (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies graph with the limit query', async () => {
    const res = await callGet('daily-luo', 'graph', 200, { nodes: [] }, 'limit=50');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/workers/daily-luo/checkpoints/graph?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('proxies status without a query', async () => {
    const res = await callGet('daily-luo', 'status', 200, { auto_enabled: true });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/workers/daily-luo/checkpoints/status',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects unknown sub with 400 before touching the controller', async () => {
    const res = await callGet('daily-luo', 'diff', 200, {});
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes through the 502 degradation message for pre-2.1 workers', async () => {
    const res = await callGet(
      'legacy',
      'graph',
      502,
      { message: 'checkpoint API unavailable (requires QwenPaw 2.1)' },
    );
    expect(res.status).toBe(502);
    const data = (await res.json()) as { message: string };
    expect(data.message).toContain('requires QwenPaw 2.1');
  });

  it('encodes the worker name in the proxied path', async () => {
    await callGet('a/b c', 'status', 200, {});
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/workers/a%2Fb%20c/checkpoints/status',
      expect.anything(),
    );
  });
});
