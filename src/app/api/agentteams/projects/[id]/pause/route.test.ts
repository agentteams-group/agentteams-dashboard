// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SERVER_USER_HEADER,
  SERVER_USER_LEVEL_HEADER,
  SERVER_USER_SCOPE_HEADER,
  SERVER_USER_TEAMS_HEADER,
  SERVER_USER_WORKERS_HEADER,
} from '@/lib/server-auth';

const originalFetch = globalThis.fetch;

function trustedHeaders(): Headers {
  return new Headers({
    [SERVER_USER_HEADER]: 'admin',
    [SERVER_USER_LEVEL_HEADER]: '3',
    [SERVER_USER_SCOPE_HEADER]: 'global',
    [SERVER_USER_TEAMS_HEADER]: '[]',
    [SERVER_USER_WORKERS_HEADER]: '[]',
  });
}

async function callPost(
  projectId: string,
  controllerStatus: number,
  controllerBody: unknown,
  requestBody: string,
  query = '',
  headers: Headers = trustedHeaders(),
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
        pathname: `/api/agentteams/projects/${projectId}/pause`,
        searchParams: new URLSearchParams(query),
      },
      headers,
      text: () => Promise.resolve(requestBody),
    } as never,
    { params: Promise.resolve({ id: projectId }) },
  );
  return response;
}

describe('POST /api/agentteams/projects/[id]/pause (proxy)', () => {
  it('returns 401 when the trusted middleware identity is missing', async () => {
    const res = await callPost('p1', 200, {}, '{}', '', new Headers());
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('forwards the reason body and returns the refreshed workflow', async () => {
    const res = await callPost('p1', 200, { project_id: 'p1', status: 'paused' }, '{"reason":"manual stop"}');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/pause',
      expect.objectContaining({
        method: 'POST',
        body: '{"reason":"manual stop"}',
      }),
    );
  });

  it('passes through 409 already-paused conflict', async () => {
    const res = await callPost('p1', 409, { error: 'project is already paused' }, '{}');
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain('already paused');
  });

  it('passes through 403 cross-team forbidden', async () => {
    const res = await callPost('p1', 403, { error: 'Forbidden' }, '{}');
    expect(res.status).toBe(403);
  });

  it('passes through 404 (project not found)', async () => {
    const res = await callPost('missing', 404, { message: 'project not found' }, '{}');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.message).toContain('not found');
  });

  it('encodes the project id in the proxied path', async () => {
    await callPost('a/b c', 200, { project_id: 'a/b c' }, '{}');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb%20c/pause',
      expect.anything(),
    );
  });

  it('forwards team query and drops controllerUrl', async () => {
    const res = await callPost('p1', 200, { project_id: 'p1' }, '{}', 'team=t1&controllerUrl=http://evil');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/pause?team=t1',
      expect.anything(),
    );
  });
});
