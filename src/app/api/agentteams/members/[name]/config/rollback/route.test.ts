// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SERVER_USER_HEADER,
  SERVER_USER_LEVEL_HEADER,
  SERVER_USER_SCOPE_HEADER,
  SERVER_USER_TEAMS_HEADER,
  SERVER_USER_WORKERS_HEADER,
} from '@/lib/server-auth';

vi.mock('@/lib/audit-log', () => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

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

async function callPost(name: string, rev?: string, headers: Headers = trustedHeaders()) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rev: 'rev-1', applied: 'applied', pendingRestart: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

  const route = await import('./route');
  return route.POST(
    {
      method: 'POST',
      nextUrl: {
        pathname: `/api/agentteams/members/${name}/config/rollback`,
        searchParams: new URLSearchParams(rev ? { rev } : {}),
      },
      headers,
    } as never,
    { params: Promise.resolve({ name }) },
  );
}

describe('POST /api/agentteams/members/[name]/config/rollback (proxy)', () => {
  it('returns 401 when the trusted middleware identity is missing', async () => {
    const res = await callPost('w1', 'rev-1', new Headers());
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 403 for a level-3 non-system admin with unknown scope', async () => {
    const headers = trustedHeaders();
    headers.delete(SERVER_USER_SCOPE_HEADER);
    const res = await callPost('w1', 'rev-1', headers);
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('forwards the target rev to the controller rollback end', async () => {
    const res = await callPost('w1', 'rev-1');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/members/w1/config/rollback?rev=rev-1',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a missing rev before proxying', async () => {
    const res = await callPost('w1');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid worker name before proxying', async () => {
    const res = await callPost('bad/name', 'rev-1');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
