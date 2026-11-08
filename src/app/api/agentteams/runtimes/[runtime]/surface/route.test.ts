// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(runtime: string, controllerStatus = 200) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ runtime, surfaceVersion: '1', faces: [] }),
        { status: controllerStatus, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );

  const route = await import('./route');
  return route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/runtimes/${runtime}/surface`,
        searchParams: new URLSearchParams(),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ runtime }) },
  );
}

describe('GET /api/agentteams/runtimes/[runtime]/surface (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the controller surface path (no /v1)', async () => {
    const res = await callGet('openclaw');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/runtimes/openclaw/surface',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes 404 through so the panel can show "endpoint unsupported"', async () => {
    const res = await callGet('qwenpaw', 404);
    expect(res.status).toBe(404);
  });

  it('rejects an invalid runtime segment before proxying', async () => {
    const res = await callGet('bad/name');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
