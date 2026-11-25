// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callPost(name: string, rev?: string) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rev: 'rev-1', applied: 'applied', pendingRestart: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

  const route = await import('./route');
  return route.POST(
    {
      method: 'POST',
      nextUrl: {
        pathname: `/api/agentteams/members/${name}/config/rollback`,
        searchParams: new URLSearchParams(rev ? { rev } : {}),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ name }) },
  );
}

describe('POST /api/agentteams/members/[name]/config/rollback (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('forwards the target rev to the controller rollback end', async () => {
    const res = await callPost('w1', 'rev-1');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/members/w1/config/rollback?rev=rev-1',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a missing rev before proxying', async () => {
    const res = await callPost('w1');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid worker name before proxying', async () => {
    const res = await callPost('bad/name', 'rev-1');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
