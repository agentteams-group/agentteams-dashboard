// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(workerName: string, controllerStatus = 200) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          runtime: 'openclaw',
          rev: 'rev-1',
          values: {},
          applied: 'pending',
          pendingRestart: ['gateway.port'],
        }),
        { status: controllerStatus, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );

  const route = await import('./route');
  return route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/members/${workerName}/config`,
        searchParams: new URLSearchParams(),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ name: workerName }) },
  );
}

describe('GET /api/agentteams/members/[name]/config (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the controller member-config path (no /v1)', async () => {
    const res = await callGet('w1');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/members/w1/config',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes through 409 runtime_unknown so the panel can degrade', async () => {
    const res = await callGet('w1', 409);
    expect(res.status).toBe(409);
  });

  it('rejects an invalid worker name before proxying', async () => {
    const res = await callGet('bad/name');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
