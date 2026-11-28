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

async function callGet(
  teamName: string,
  controllerStatus: number,
  query = '',
  responseHeaders: Record<string, string> = {},
  headers: Headers = trustedHeaders(),
) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          team_id: teamName,
          items: [],
          count: 0,
          truncated: false,
        }),
        { status: controllerStatus, headers: responseHeaders },
      ),
    ),
  );

  const route = await import('./route');
  const response = await route.GET(
    {
      method: 'GET',
      nextUrl: {
        pathname: `/api/agentteams/teams/${teamName}/attention`,
        searchParams: new URLSearchParams(query),
      },
      headers,
    } as never,
    { params: Promise.resolve({ name: teamName }) },
  );
  return response;
}

describe('GET /api/agentteams/teams/[name]/attention (proxy)', () => {
  it('returns 401 when the trusted middleware identity is missing', async () => {
    const res = await callGet('biz-team', 200, '', {}, new Headers());
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 403 for a level-3 non-system admin with unknown scope', async () => {
    const headers = trustedHeaders();
    headers.delete(SERVER_USER_SCOPE_HEADER);
    const res = await callGet('biz-team', 200, '', {}, headers);
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('proxies to the canonical controller path', async () => {
    const res = await callGet('biz-team', 200);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/teams/biz-team/attention',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards status/limit and drops controllerUrl', async () => {
    await callGet('biz-team', 200, 'status=overdue&limit=1000&controllerUrl=http://evil');
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/teams/biz-team/attention?status=overdue&limit=1000',
      expect.anything(),
    );
  });

  it('encodes the team name in the proxied path', async () => {
    await callGet('a/b c', 200);
    expect(fetch).toHaveBeenCalledWith(
      'http://controller.test/api/v1/teams/a%2Fb%20c/attention',
      expect.anything(),
    );
  });

  it('passes through 404 (team missing / endpoint not deployed yet)', async () => {
    const res = await callGet('ghost', 404);
    expect(res.status).toBe(404);
  });

  it('passes through 400 for an invalid status/limit', async () => {
    const res = await callGet('biz-team', 400, 'status=bogus');
    expect(res.status).toBe(400);
  });

  it('forwards the degradation and truncation headers', async () => {
    const res = await callGet('biz-team', 200, '', {
      'x-attention-skipped': '2',
      'x-attention-truncated': '1',
    });
    expect(res.headers.get('x-attention-skipped')).toBe('2');
    expect(res.headers.get('x-attention-truncated')).toBe('1');
  });
});
