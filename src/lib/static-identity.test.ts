// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { __resetStaticIdentityCacheForTests, resolveStaticIdentity } from './static-identity';

function requestWith(token?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest('http://dashboard.test/api/agentteams/teams', { headers });
}

/** Route-aware fetch mock: (url, status, json) per path prefix. */
function mockProbes(handlers: Array<{ prefix: string; status: number; body?: unknown }>, networkErrorPrefixes: string[] = []) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (networkErrorPrefixes.some((p) => url.startsWith(p))) {
      throw new Error('network down');
    }
    const hit = handlers.find((h) => url.startsWith(h.prefix));
    const status = hit?.status ?? 404;
    const body = hit?.body ?? {};
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch);
  return calls;
}

describe('resolveStaticIdentity (F7 static-mode identity ladder)', () => {
  beforeEach(() => {
    __resetStaticIdentityCacheForTests();
    process.env.AGENTTEAMS_API_URL = 'http://127.0.0.1:1';
    vi.stubEnv('AGENTTEAMS_API_URL', 'http://127.0.0.1:1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns null when no bearer token is present', async () => {
    const calls = mockProbes([]);
    const result = await resolveStaticIdentity(requestWith(undefined));
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('resolves an L1 Human name directly through Controller without an admin probe', async () => {
    const calls = mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/me', status: 200, body: { name: 'human-alice', permissionLevel: 1, accessibleTeams: [] } },
    ]);
    expect(await resolveStaticIdentity(requestWith('alice-token'))).toEqual({ ok: true, identity: { name: 'human-alice', level: 3, teams: [] } });
    expect(calls).toEqual(['http://127.0.0.1:1/api/v1/me']);
  });

  it('admin-grade token (humans list 200) → level 3, name admin', async () => {
    mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/humans', status: 200, body: { humans: [] } },
    ]);
    const result = await resolveStaticIdentity(requestWith('sa-token'));
    expect(result).toEqual({ ok: true, identity: { name: 'admin', level: 3, teams: [] } });
  });

  it('L2 team token: humans 403 → teams 200+list → whoami → {name, 2, teams}', async () => {
    mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/humans', status: 403, body: { error: 'forbidden' } },
      { prefix: 'http://127.0.0.1:1/api/v1/teams', status: 200, body: { teams: [{ name: 'alpha-team' }, { name: 'beta-team' }] } },
      { prefix: 'http://127.0.0.1:1:6167', status: 404, body: {} }, // whoami unreachable at placeholder
    ]);
    const result = await resolveStaticIdentity(requestWith('matrix-l2'));
    expect(result).toEqual({
      ok: true,
      identity: { name: 'user', level: 2, teams: ['alpha-team', 'beta-team'] },
    });
  });

  it('whoami success gives the localpart as the display name', async () => {
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://127.0.0.1:6167');
    mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/humans', status: 403 },
      { prefix: 'http://127.0.0.1:1/api/v1/teams', status: 200, body: { teams: [{ name: 'alpha-team' }] } },
      { prefix: 'http://127.0.0.1:6167/_matrix/client/v3/account/whoami', status: 200, body: { user_id: '@alice:example.com' } },
    ]);
    const result = await resolveStaticIdentity(requestWith('matrix-l2'));
    expect(result).toEqual({
      ok: true,
      identity: { name: 'alice', level: 2, teams: ['alpha-team'] },
    });
  });

  it('L3 worker token: teams 200+empty, workers 200+non-empty → level 1', async () => {
    mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/humans', status: 403 },
      { prefix: 'http://127.0.0.1:1/api/v1/teams', status: 200, body: { teams: [] } },
      { prefix: 'http://127.0.0.1:1/api/v1/workers', status: 200, body: { workers: [{ name: 'worker-1' }] } },
    ]);
    const result = await resolveStaticIdentity(requestWith('matrix-l3'));
    expect(result).toEqual({ ok: true, identity: { name: 'user', level: 1, teams: [] } });
  });

  it('L2 with ZERO teams: teams 200+empty, workers 200+empty → level 2 (not invalid)', async () => {
    mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/humans', status: 403 },
      { prefix: 'http://127.0.0.1:1/api/v1/teams', status: 200, body: { teams: [] } },
      { prefix: 'http://127.0.0.1:1/api/v1/workers', status: 200, body: { workers: [] } },
    ]);
    const result = await resolveStaticIdentity(requestWith('matrix-l2-empty'));
    expect(result).toEqual({ ok: true, identity: { name: 'user', level: 2, teams: [] } });
  });

  it('auth failure on all probes (401) → invalid (definitive)', async () => {
    mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/', status: 401, body: { error: 'Unknown user ID' } },
    ]);
    const result = await resolveStaticIdentity(requestWith('expired-token'));
    expect(result).toMatchObject({ ok: 'invalid' });
  });

  it('all controller addresses network-down → unreachable (not invalid)', async () => {
    mockProbes([], ['http://127.0.0.1:1']);
    const result = await resolveStaticIdentity(requestWith('any-token'));
    expect(result).toMatchObject({ ok: 'unreachable' });
  });

  it('fails over to the next controller base on a network error', async () => {
    vi.stubEnv('AGENTTEAMS_API_URL', 'http://127.0.0.1:1,http://127.0.0.1:2');
    mockProbes(
      [
        { prefix: 'http://127.0.0.1:2/api/v1/humans', status: 200, body: { humans: [] } },
      ],
      ['http://127.0.0.1:1'],
    );
    const result = await resolveStaticIdentity(requestWith('sa-token'));
    expect(result).toEqual({ ok: true, identity: { name: 'admin', level: 3, teams: [] } });
  });

  it('caches resolutions for the token (no re-probe on the second call)', async () => {
    const calls = mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/humans', status: 200, body: { humans: [] } },
    ]);
    const first = await resolveStaticIdentity(requestWith('sa-token'));
    const second = await resolveStaticIdentity(requestWith('sa-token'));
    expect(first).toEqual(second);
    const humansCalls = calls.filter((u) => u.includes('/api/v1/humans'));
    expect(humansCalls).toHaveLength(1);
  });

  it('does not cache failures (retry after the backend comes back)', async () => {
    const calls = mockProbes([], ['http://127.0.0.1:1']);
    const first = await resolveStaticIdentity(requestWith('tok'));
    expect(first).toMatchObject({ ok: 'unreachable' });
    // backend recovers
    vi.restoreAllMocks();
    mockProbes([{ prefix: 'http://127.0.0.1:1/api/v1/humans', status: 200, body: { humans: [] } }]);
    const second = await resolveStaticIdentity(requestWith('tok'));
    expect(second).toMatchObject({ ok: true });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('rejects a forged client-supplied homeserver header (allowlist) but falls back to defaults', async () => {
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://127.0.0.1:6167');
    mockProbes([
      { prefix: 'http://127.0.0.1:1/api/v1/humans', status: 403 },
      { prefix: 'http://127.0.0.1:1/api/v1/teams', status: 200, body: { teams: [{ name: 't' }] } },
      { prefix: 'http://127.0.0.1:6167/_matrix/client/v3/account/whoami', status: 200, body: { user_id: '@a:b' } },
    ]);
    const req = requestWith('matrix-tok', {
      'x-agentteams-homeserver': 'http://169.254.169.254/latest/meta-data',
    });
    const result = await resolveStaticIdentity(req);
    // the metadata-IP candidate is dropped by the allowlist; the configured
    // matrix URL resolves the name instead.
    expect(result).toMatchObject({ ok: true, identity: { name: 'a', level: 2 } });
  });
});
