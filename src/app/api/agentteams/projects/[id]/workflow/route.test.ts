// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(
  projectId: string,
  controllerStatus: number,
  controllerBody: unknown,
  query = '',
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(controllerBody), {
        status: controllerStatus,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/workflow`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ id: projectId }) },
  );
  return response;
}

describe('GET /api/agentteams/projects/[id]/workflow (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('passes through a successful workflow response', async () => {
    const res = await callGet('p1', 200, {
      project_id: 'p1',
      title: 'A',
      status: 'active',
      nodes: [],
      edges: [],
      next: [],
      interrupts: [],
      values: {},
    });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/workflow',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes through 404 (project not found) without degrading', async () => {
    const res = await callGet('missing', 404, { error: 'Not Found' });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('Not Found');
  });

  it('passes through 403 (cross-team forbidden)', async () => {
    const res = await callGet('p1', 403, { error: 'Forbidden' });
    expect(res.status).toBe(403);
  });

  it('encodes the project id in the proxied path', async () => {
    await callGet('a/b c', 200, {
      project_id: 'a/b c',
      nodes: [],
      edges: [],
      next: [],
      interrupts: [],
      values: {},
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/workflow',
      expect.anything(),
    );
  });

  it('forwards query params (includeTasks) and drops controllerUrl', async () => {
    const res = await callGet('p1', 200, {
      project_id: 'p1',
      nodes: [],
      edges: [],
      next: [],
      interrupts: [],
      values: {},
    }, 'includeTasks=true&controllerUrl=http://evil');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/workflow?includeTasks=true',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps an empty query string when no params are forwarded', async () => {
    const res = await callGet('p1', 200, {
      project_id: 'p1',
      nodes: [],
      edges: [],
      next: [],
      interrupts: [],
      values: {},
    }, 'controllerUrl=http://evil');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/workflow',
      expect.anything(),
    );
  });
});
