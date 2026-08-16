// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callPost(
  projectId: string,
  taskId: string,
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
        pathname: `/api/agentteams/projects/${projectId}/tasks/${taskId}/cancel`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
      text: () => Promise.resolve(requestBody),
    } as never,
    { params: Promise.resolve({ id: projectId, taskId }) },
  );
  return response;
}

describe('POST /api/agentteams/projects/[id]/tasks/[taskId]/cancel (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('forwards the reason body and returns the refreshed workflow', async () => {
    const res = await callPost(
      'p1',
      't1',
      200,
      { project_id: 'p1', status: 'active' },
      '{"reason":"blocked indefinitely"}',
    );
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/tasks/t1/cancel',
      expect.objectContaining({
        method: 'POST',
        body: '{"reason":"blocked indefinitely"}',
      }),
    );
  });

  it('passes through 400 missing reason', async () => {
    const res = await callPost('p1', 't1', 400, { message: 'reason is required' }, '{}');
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toContain('reason');
  });

  it('passes through 404 (task not in project)', async () => {
    const res = await callPost('p1', 'unknown', 404, { message: 'task not found in project' }, '{"reason":"x"}');
    expect(res.status).toBe(404);
  });

  it('passes through 409 terminal task', async () => {
    const res = await callPost('p1', 't1', 409, { message: 'cannot cancel terminal task: completed' }, '{"reason":"x"}');
    expect(res.status).toBe(409);
  });

  it('encodes both ids in the proxied path', async () => {
    await callPost('a/b c', 't/1', 200, { project_id: 'a/b c' }, '{"reason":"x"}');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/tasks/t%2F1/cancel',
      expect.anything(),
    );
  });

  it('forwards team query and drops controllerUrl', async () => {
    const res = await callPost('p1', 't1', 200, { project_id: 'p1' }, '{"reason":"x"}', 'team=t1&controllerUrl=http://evil');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/tasks/t1/cancel?team=t1',
      expect.anything(),
    );
  });
});
