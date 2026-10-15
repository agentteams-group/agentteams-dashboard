// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet() {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ task_id: 't1', run: 'run-20261015-131415.log', team: 'alpha' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

  const route = await import('./route');
  return route.GET({
    method: 'GET',
    nextUrl: { pathname: '/api/agentteams/coding-runs', searchParams: new URLSearchParams() },
    headers: new Headers(),
  } as never);
}

describe('GET /api/agentteams/coding-runs (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies the upstream coding-runs list', async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { task_id: 't1', run: 'run-20261015-131415.log', team: 'alpha' },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/coding-runs',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
