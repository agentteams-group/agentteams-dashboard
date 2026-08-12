// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(
  projectId: string,
  taskId: string,
  controllerStatus: number,
  controllerBody: BodyInit | null,
  controllerHeaders: Record<string, string> = { 'content-type': 'application/json' },
  query = '',
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(controllerBody, {
        status: controllerStatus,
        headers: controllerHeaders,
      }),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/projects/${projectId}/tasks/${taskId}/artifact`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ id: projectId, taskId }) },
  );
  return response;
}

describe('GET /api/agentteams/projects/[id]/tasks/[taskId]/artifact (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('streams a successful binary artifact with its content-type', async () => {
    const body = new TextEncoder().encode('PDF-BYTES-123');
    const res = await callGet('p1', 't1', 200, body, { 'content-type': 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await res.arrayBuffer()).toEqual(body.buffer);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/tasks/t1/artifact',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes through content-disposition (RFC 5987 filename)', async () => {
    const res = await callGet('p1', 't1', 200, 'x', {
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''%E6%96%B9%E6%A1%88.pdf",
    });
    expect(res.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''%E6%96%B9%E6%A1%88.pdf",
    );
  });

  it('passes through 404 (artifact missing)', async () => {
    const res = await callGet('p1', 'missing', 404, JSON.stringify({ error: 'artifact not found' }), {
      'content-type': 'application/json',
    });
    expect(res.status).toBe(404);
  });

  it('passes through 400 (invalid deliverable path)', async () => {
    const res = await callGet('p1', 't1', 400, JSON.stringify({ error: 'invalid path' }), {
      'content-type': 'application/json',
    });
    expect(res.status).toBe(400);
  });

  it('forwards ?path= query and drops controllerUrl', async () => {
    await callGet('p1', 't1', 200, 'x', { 'content-type': 'text/plain' }, 'path=results%2Fout.pdf&controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/p1/tasks/t1/artifact?path=results%2Fout.pdf',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('encodes project/task ids in the proxied path', async () => {
    await callGet('a/b', 't t', 200, 'x', { 'content-type': 'text/plain' });
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/projects/a%2Fb/tasks/t%20t/artifact',
      expect.anything(),
    );
  });
});
