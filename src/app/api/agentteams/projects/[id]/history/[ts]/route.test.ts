// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const TS = '1723785123456789020';

async function callGet(
  projectId: string,
  ts: string,
  controllerStatus: number,
  query = '',
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'paused', title: 't' }), {
        status: controllerStatus,
      }),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/history/${ts}`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ id: projectId, ts }) },
  );
  return response;
}

describe('GET /api/agentteams/projects/[id]/history/[ts] (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the canonical snapshot path with the raw timestamp', async () => {
    const res = await callGet('p1', TS, 200);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      `http://controller.test/api/v1/projects/p1/history/${TS}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards team query and drops controllerUrl', async () => {
    await callGet('p1', TS, 200, 'team=biz-team&controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      `http://controller.test/api/v1/projects/p1/history/${TS}?team=biz-team`,
      expect.anything(),
    );
  });

  it('encodes both id and timestamp segments', async () => {
    await callGet('a/b c', 'x/9', 200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/history/x%2F9',
      expect.anything(),
    );
  });

  it('passes through 404 (snapshot missing / endpoint not deployed yet)', async () => {
    const res = await callGet('p1', '123', 404);
    expect(res.status).toBe(404);
  });
});
