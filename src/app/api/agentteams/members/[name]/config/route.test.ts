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

async function callGet(workerName: string, controllerStatus = 200, headers: Headers = trustedHeaders()) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          runtime: 'openclaw',
          rev: 'rev-1',
          values: {},
          applied: 'pending',
          pendingRestart: ['gateway.port'],
        }),
        { status: controllerStatus, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );

  const route = await import('./route');
  return route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/members/${workerName}/config`,
        searchParams: new URLSearchParams(),
      },
      headers,
    } as never,
    { params: Promise.resolve({ name: workerName }) },
  );
}

describe('GET /api/agentteams/members/[name]/config (proxy)', () => {
  it('returns 401 when the trusted middleware identity is missing', async () => {
    const res = await callGet('w1', 200, new Headers());
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the controller member-config path (no /v1)', async () => {
    const res = await callGet('w1');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/members/w1/config',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes through 409 runtime_unknown so the panel can degrade', async () => {
    const res = await callGet('w1', 409);
    expect(res.status).toBe(409);
  });

  it('rejects an invalid worker name before proxying', async () => {
    const res = await callGet('bad/name');
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

async function callPut(workerName: string, rev?: string, headers: Headers = trustedHeaders()) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rev: 'rev-2', applied: 'applied', pendingRestart: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

  const route = await import('./route');
  const body = JSON.stringify({ patch: { gateway: { port: 9090 } } });
  return route.PUT(
    {
      method: 'PUT',
      nextUrl: {
        pathname: `/api/agentteams/members/${workerName}/config`,
        searchParams: new URLSearchParams(rev ? { 'if-rev': rev } : {}),
      },
      headers,
      text: async () => body,
    } as never,
    { params: Promise.resolve({ name: workerName }) },
  );
}

describe('PUT /api/agentteams/members/[name]/config (proxy)', () => {
  it('returns 403 for a level-3 non-system admin with unknown scope', async () => {
    const headers = trustedHeaders();
    headers.delete(SERVER_USER_SCOPE_HEADER);
    const res = await callPut('w1', undefined, headers);
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('forwards the nested patch with the if-rev optimistic lock', async () => {
    const res = await callPut('w1', 'rev-1');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/members/w1/config?if-rev=rev-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ patch: { gateway: { port: 9090 } } }) }),
    );
  });

  it('omits if-rev when the client has no read token', async () => {
    await callPut('w1');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/members/w1/config',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
