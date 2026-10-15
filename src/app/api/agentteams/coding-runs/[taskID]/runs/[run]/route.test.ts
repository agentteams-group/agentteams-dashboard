// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function callGet(taskID: string, run: string, query = '') {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('2026-10-15T13:14:15 hello from coding cli\n', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    ),
  );

  const route = await import('./route');
  return route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/coding-runs/${taskID}/runs/${run}`,
        searchParams: new URLSearchParams(query),
      },
      headers: new Headers(),
    } as never,
    { params: Promise.resolve({ taskID, run }) },
  );
}

describe('GET /api/agentteams/coding-runs/[taskID]/runs/[run] (proxy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('passes the raw text/plain log through', async () => {
    const res = await callGet('t1', 'run-20261015-131415.log');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('2026-10-15T13:14:15 hello from coding cli\n');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/coding-runs/t1/runs/run-20261015-131415.log',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards the ?team= query', async () => {
    await callGet('t1', 'run-20261015-131415.log', 'team=alpha');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/coding-runs/t1/runs/run-20261015-131415.log?team=alpha',
      expect.anything(),
    );
  });

  it('rejects a traversal-y task id without calling upstream', async () => {
    const res = await callGet('..', 'run-20261015-131415.log');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a task id with a space (upstream isSafeTaskID parity)', async () => {
    const res = await callGet('t 1', 'run-20261015-131415.log');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a malformed run file without calling upstream', async () => {
    const res = await callGet('t1', '../etc/passwd');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
