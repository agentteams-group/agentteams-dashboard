// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(
  projectId: string,
  sessionId: string,
  controllerStatus: number,
  query = '',
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ session_id: sessionId, messages: [], has_more: false }),
        { status: controllerStatus },
      ),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/spawns/${sessionId}/messages`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ id: projectId, sessionId }) },
  );
  return response;
}

describe('GET /api/agentteams/projects/[id]/spawns/[sessionId]/messages (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the canonical controller path with the limit', async () => {
    const res = await callGet('p1', 'sub-1', 200, 'limit=50');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/spawns/sub-1/messages?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('encodes both ids and drops controllerUrl', async () => {
    await callGet('a/b', 'sub/2', 200, 'controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb/spawns/sub%2F2/messages',
      expect.anything(),
    );
  });

  it('passes through 404 (no history mirror) and 403 (cross-team)', async () => {
    expect((await callGet('p1', 'sub-1', 404)).status).toBe(404);
    expect((await callGet('p1', 'sub-1', 403)).status).toBe(403);
  });
});
