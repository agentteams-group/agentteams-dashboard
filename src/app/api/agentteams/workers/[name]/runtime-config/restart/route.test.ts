// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callPost(workerName: string, controllerStatus = 200) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: workerName, phase: 'Running' }), {
        status: controllerStatus,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

  const route = await import('./route');
  return route.POST(
    {
      method: 'POST',
      nextUrl: {
        pathname: `/api/agentteams/workers/${workerName}/runtime-config/restart`,
        searchParams: new URLSearchParams(),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ name: workerName }) },
  );
}

describe('POST /api/agentteams/workers/[name]/runtime-config/restart (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the controller worker restart end', async () => {
    const res = await callPost('w1');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/workers/w1/restart',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('passes 404 through (worker disappeared)', async () => {
    const res = await callPost('ghost', 404);
    expect(res.status).toBe(404);
  });

  it('passes 409 through (concurrent update conflict)', async () => {
    const res = await callPost('w1', 409);
    expect(res.status).toBe(409);
  });

  it('rejects an invalid worker name before proxying', async () => {
    const res = await callPost('bad/name');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
