// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callPost(
  projectId: string,
  controllerStatus: number,
  controllerBody: unknown,
  requestBody: string,
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
  const response = await route.POST(
    {
      method: 'POST',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/replan`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
      text: () => Promise.resolve(requestBody),
    } as never,
    { params: Promise.resolve({ id: projectId }) },
  );
  return response;
}

describe('POST /api/agentteams/projects/[id]/replan (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('forwards the tasks body and returns the refreshed workflow', async () => {
    const res = await callPost(
      'p1',
      200,
      { project_id: 'p1', status: 'active' },
      '{"tasks":[{"taskId":"t1","title":"A"}]}',
    );
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/replan',
      expect.objectContaining({
        method: 'POST',
        body: '{"tasks":[{"taskId":"t1","title":"A"}]}',
      }),
    );
  });

  it('passes through 400 invalid body', async () => {
    const res = await callPost('p1', 400, { error: 'invalid request body' }, 'not-json');
    expect(res.status).toBe(400);
  });

  it('passes through 409 precondition conflict', async () => {
    const res = await callPost('p1', 409, { error: 'cannot replan while tasks are running' }, '{"tasks":[]}');
    expect(res.status).toBe(409);
  });

  it('passes through 404 (project not found)', async () => {
    const res = await callPost('missing', 404, { message: 'project not found' }, '{"tasks":[]}');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.message).toContain('not found');
  });

  it('encodes the project id in the proxied path', async () => {
    await callPost('a/b c', 200, { project_id: 'a/b c' }, '{"tasks":[]}');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/replan',
      expect.anything(),
    );
  });

  it('forwards team query and drops controllerUrl', async () => {
    const res = await callPost('p1', 200, { project_id: 'p1' }, '{"tasks":[]}', 'team=t1&controllerUrl=http://evil');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/replan?team=t1',
      expect.anything(),
    );
  });
});
