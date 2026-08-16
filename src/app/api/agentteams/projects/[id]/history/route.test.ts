// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(projectId: string, controllerStatus: number, query = '') {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ project_id: projectId, snapshots: [] }),
        { status: controllerStatus },
      ),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/history`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ id: projectId }) },
  );
  return response;
}

describe('GET /api/agentteams/projects/[id]/history (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the canonical controller path', async () => {
    const res = await callGet('p1', 200);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/history',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards team query and drops controllerUrl', async () => {
    await callGet('p1', 200, 'team=biz-team&controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/history?team=biz-team',
      expect.anything(),
    );
  });

  it('encodes the project id in the proxied path', async () => {
    await callGet('a/b c', 200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/history',
      expect.anything(),
    );
  });

  it('passes through 404 (project missing / endpoint not deployed yet)', async () => {
    const res = await callGet('ghost', 404);
    expect(res.status).toBe(404);
  });

  it('passes through 403 cross-team', async () => {
    const res = await callGet('p1', 403);
    expect(res.status).toBe(403);
  });
});
