// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(projectId: string, controllerStatus: number, query = '') {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ project_id: projectId, workers: [] }), {
        status: controllerStatus,
      }),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/spawns`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ id: projectId }) },
  );
  return response;
}

describe('GET /api/agentteams/projects/[id]/spawns (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the canonical controller path', async () => {
    const res = await callGet('p1', 200);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/spawns',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards team and drops controllerUrl', async () => {
    await callGet('p1', 200, 'team=biz-team&controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/spawns?team=biz-team',
      expect.anything(),
    );
  });

  it('encodes the project id in the proxied path', async () => {
    await callGet('a/b c', 200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/spawns',
      expect.anything(),
    );
  });

  it('passes through 404/405 (spawn routes not deployed)', async () => {
    expect((await callGet('ghost', 404)).status).toBe(404);
    expect((await callGet('ghost', 405)).status).toBe(405);
  });
});
