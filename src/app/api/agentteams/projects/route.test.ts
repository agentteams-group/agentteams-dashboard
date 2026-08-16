// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(routePath: string, controllerStatus: number, controllerBody: unknown) {
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

  // Import the route fresh so proxy-helper reads the stubbed env.
  const route = await import('./route');
  const url = new URL(`http://dashboard.test${routePath}`);
  const response = await route.GET({
    method: 'GET',
    nextUrl: { pathname: url.pathname, searchParams: url.searchParams },
    headers: new Headers(),
  } as never);
  return response;
}

describe('GET /api/agentteams/projects (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('passes through a successful controller response', async () => {
    const res = await callGet('/api/agentteams/projects', 200, {
      projects: [{ project_id: 'p1', title: 'A', status: 'active' }],
      total: 1,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projects).toHaveLength(1);
    expect(data.degraded).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('degrades to an empty list (200) when the controller API is missing (404)', async () => {
    const res = await callGet('/api/agentteams/projects', 404, { error: 'Not Found' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projects).toEqual([]);
    expect(data.degraded).toBe(true);
    expect(data.degradedReason).toBe('api-not-deployed');
    expect(data.error).toContain('Not Found');
  });

  it('degrades to an empty list (200) on server error, marking controller-error', async () => {
    const res = await callGet('/api/agentteams/projects', 500, { error: 'boom' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projects).toEqual([]);
    expect(data.degraded).toBe(true);
    expect(data.degradedReason).toBe('controller-error');
  });

  it('keeps the controller error message in the degraded body', async () => {
    const res = await callGet('/api/agentteams/projects', 500, { error: 'minio unreachable' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error).toContain('minio unreachable');
  });

  it('forwards query params to the controller and drops the internal controllerUrl override', async () => {
    const res = await callGet('/api/agentteams/projects?team=biz&controllerUrl=http://evil', 200, {
      projects: [],
      total: 0,
    });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects?team=biz',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
