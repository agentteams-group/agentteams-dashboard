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
        JSON.stringify({
          project_id: projectId,
          events: [],
          count: 0,
        }),
        { status: controllerStatus },
      ),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/signal-events`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ id: projectId }) },
  );
  return response;
}

describe('GET /api/agentteams/projects/[id]/signal-events (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the canonical controller path', async () => {
    const res = await callGet('p1', 200);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/signal-events',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards type/task/since/limit/cursor/team and drops controllerUrl', async () => {
    await callGet(
      'p1',
      200,
      'team=biz-team&type=SIG_PAUSE&type=SIG_RESUME&task=t1&since=2026-11-01T00%3A00%3A00Z&limit=100&cursor=abc&controllerUrl=http://evil',
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/signal-events?team=biz-team&type=SIG_PAUSE&type=SIG_RESUME&task=t1&since=2026-11-01T00%3A00%3A00Z&limit=100&cursor=abc',
      expect.anything(),
    );
  });

  it('encodes the project id in the proxied path', async () => {
    await callGet('a/b c', 200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/signal-events',
      expect.anything(),
    );
  });

  it('passes through 404 (project missing / endpoint not deployed yet)', async () => {
    const res = await callGet('ghost', 404);
    expect(res.status).toBe(404);
  });

  it('passes through 400 invalid cursor', async () => {
    const res = await callGet('p1', 400);
    expect(res.status).toBe(400);
  });
});
