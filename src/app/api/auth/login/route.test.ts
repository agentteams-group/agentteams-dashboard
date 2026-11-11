// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import {
  callHigressConsole,
  getHigressConsoleURL,
  HigressConsoleConfigurationError,
} from '../../higress/proxy-helper';
import { getAuthToken } from '../../agentteams/proxy-helper';
import { __resetSessionStoreForTests, SESSION_COOKIE_NAME, getSessionFromRequest } from '@/lib/dashboard-session';

vi.mock('../../higress/proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  forwardCookies: vi.fn(),
  // Same contract as the real helper: Set-Cookie list → request Cookie value.
  collectSetCookieHeader: (headers: Headers) => {
    const parts = headers
      .getSetCookie()
      .map((c) => c.split(';')[0]?.trim())
      .filter((c): c is string => Boolean(c && c.includes('=')));
    return parts.length > 0 ? parts.join('; ') : undefined;
  },
  getHigressConsoleURL: vi.fn(() => 'http://higress-console:8080'),
  HigressConsoleConfigurationError: class extends Error {},
}));
vi.mock('../../agentteams/proxy-helper', () => ({
  getControllerUrl: vi.fn(() => 'http://controller.test:8090'),
  getAuthToken: vi.fn(async () => undefined),
}));
vi.mock('@/lib/homeserver-allowlist', () => ({ validateHomeserverUrl: vi.fn() }));

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://dashboard.test/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username: 'alice', password: 'password', ...extra }),
  });
}

/** /api/v1/me with the user's own token. */
interface MeBehavior { status: number; body?: unknown }
interface ScenarioOpts {
  matrixUserId?: string;
  /** Omitted → 200 with the default Human (L2). */
  me?: MeBehavior;
  /** /api/v1/humans/{localpart} with the server SA token. Omitted → 404 (no CR). */
  saHuman?: { status: number; body?: unknown } | 'network';
  /** /api/v1/status with the user's own token (legacy L2 probe). Omitted → 200. */
  legacyStatus?: number | 'network';
  /** /api/v1/teams with the user's own token (legacy L2 scope). */
  legacyTeams?: { status: number; teams: Array<{ name: string }> };
  /** Matrix password login. */
  matrixLoginStatus?: number;
}

const HUMAN = (level: number) => ({
  name: 'human-alice', permissionLevel: level, accessibleTeams: ['team-a'],
});

function installFetch(opts: ScenarioOpts = {}) {
  const {
    matrixUserId = '@alice:matrix.local',
    me = { status: 200, body: HUMAN(2) },
    saHuman: saHumanBehavior = { status: 404, body: { error: 'not found' } },
    legacyStatus = 200,
    legacyTeams = { status: 200, teams: [{ name: 'team-a' }] },
    matrixLoginStatus = 200,
  } = opts;

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/_matrix/client/v3/login')) {
      return Response.json(
        { access_token: 'own-matrix-token', user_id: matrixUserId, device_id: 'device' },
        { status: matrixLoginStatus },
      );
    }
    if (url.endsWith('/api/v1/me')) {
      return Response.json(me.body ?? null, { status: me.status });
    }
    if (/\/api\/v1\/humans\/[^/?]+$/.test(url)) {
      if (saHumanBehavior === 'network') throw new Error('network down');
      return Response.json(saHumanBehavior.body ?? null, { status: saHumanBehavior.status });
    }
    if (url.endsWith('/api/v1/status')) {
      if (legacyStatus === 'network') throw new Error('network down');
      return Response.json({ ok: true }, { status: legacyStatus });
    }
    if (url.endsWith('/api/v1/teams')) {
      return Response.json({ teams: legacyTeams.teams }, { status: legacyTeams.status });
    }
    throw new Error('Unexpected privileged lookup: ' + url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Console track answers: a successful admin login. */
function consoleOk() {
  vi.mocked(callHigressConsole).mockResolvedValue({ response: new Response(null, { status: 200 }), body: {} });
}
/** Console track answers: credentials rejected. */
function consoleRejected() {
  vi.mocked(callHigressConsole).mockResolvedValue({ response: new Response(null, { status: 401 }), body: {} });
}
/** Console deployment misconfiguration (host not on the allowlist). */
function consoleMisconfigured() {
  vi.mocked(getHigressConsoleURL).mockImplementation(() => {
    throw new HigressConsoleConfigurationError('host not on the allowlist');
  });
}

const ADMIN_CONS = { username: 'admin', password: 'admin-pass' };
const ADMIN_CONSOLE_COOKIE = 'hi_console_sess=verified-console-session';

/** Console track: rejects the user's own credentials but accepts the
 * deployment admin pair (explicit administrator verification). */
function consoleAdminVerification(consoleCookie = ADMIN_CONSOLE_COOKIE) {
  vi.mocked(callHigressConsole).mockImplementation(async (_path, options = {}) => {
    const body = (options.body ?? {}) as Record<string, unknown>;
    const accepted =
      body.username === ADMIN_CONS.username && body.password === ADMIN_CONS.password;
    return {
      response: accepted
        ? new Response(null, { status: 200, headers: { 'set-cookie': consoleCookie } })
        : new Response(null, { status: 401 }),
      body: {},
    };
  });
}

function sessionFrom(res: NextResponse) {
  const cookie = res.headers.get('set-cookie')!;
  return getSessionFromRequest(new NextRequest('http://dashboard.test/', {
    headers: { cookie: cookie.split(';')[0] },
  }));
}

describe('Human login through Controller', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('DASHBOARD_SESSION_SECRET', 'c'.repeat(64));
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'direct');
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'must-not-be-used');
    vi.mocked(callHigressConsole).mockReset();
    vi.mocked(getHigressConsoleURL).mockReset();
    vi.mocked(getHigressConsoleURL).mockReturnValue('http://higress-console:8080');
    vi.mocked(getAuthToken).mockReset();
    vi.mocked(getAuthToken).mockResolvedValue(undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  // ── Embedded dual track: Console first, then Matrix ──────────────────

  it('logs the Console admin in without running the Matrix identity track', async () => {
    consoleOk();
    const fetchMock = installFetch();
    const res = await POST(request({ username: 'admin' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe('higress');
    expect(data.user).toEqual({ username: 'admin', level: 3 });
    const session = sessionFrom(res);
    expect(session?.credential).toEqual({ kind: 'sa' });
    expect(res.headers.get('set-cookie')).not.toContain('own-matrix-token');
    // No Controller identity fetch at all — the Matrix track (and its SA
    // fallback) never runs once the Console track has a session. The only
    // upstream call is the chat-convenience Matrix login (allowMatrix: true).
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/_matrix/client/v3/login');
  });

  it('falls through to the Matrix track after a Console 401', async () => {
    consoleRejected();
    installFetch({ me: { status: 200, body: HUMAN(2) } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe('matrix');
    expect(data.user).toEqual({ username: 'human-alice', level: 2 });
  });

  it('does not surface the Console misconfiguration when the Matrix track succeeds', async () => {
    consoleMisconfigured();
    // A NEW L1 on a modern Controller (its own /me) must not be blocked by
    // the admin-account deployment gap.
    installFetch({ me: { status: 200, body: HUMAN(1) } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe('matrix');
  });

  // ── Modern Controller: /me with the user's own token (#214) ──────────

  for (const [crLevel, level] of [[1, 3], [2, 2], [3, 1]]) {
    it('logs in Human level ' + crLevel + ' with only its own credentials', async () => {
      const fetchMock = installFetch({ me: { status: 200, body: HUMAN(crLevel) } });
      consoleRejected();
      const res = await POST(request());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user).toEqual({ username: 'human-alice', level });
      expect(data.matrix.accessToken).toBe('own-matrix-token');
      const cookie = res.headers.get('set-cookie')!;
      expect(cookie).not.toContain('own-matrix-token');
      expect(cookie).not.toContain('must-not-be-used');
      const session = sessionFrom(res);
      // Modern /me path: the user's own token is the session credential
      // (#214) — even for L1, the server SA token is never involved.
      expect(session?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
      expect(session?.consoleCookie).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith('http://controller.test:8090/api/v1/me', expect.objectContaining({
        headers: { Authorization: 'Bearer own-matrix-token' },
      }));
      // The Console track runs once first (dual track), and the SA Human
      // lookup never happens on the modern path.
      expect(callHigressConsole).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain(
        expect.stringContaining('/api/v1/humans/'),
      );
      expect(cookie).toContain(SESSION_COOKIE_NAME);
    });
  }

  it('uses only the own token for /me even when an SA token is configured', async () => {
    vi.mocked(getAuthToken).mockResolvedValue('sa-token');
    consoleRejected();
    const fetchMock = installFetch({ me: { status: 200, body: HUMAN(1) } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(sessionFrom(res)?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain(
      expect.stringContaining('/api/v1/humans/'),
    );
  });

  it('logs in a modern L1 Human without any admin verification (new auth path)', async () => {
    consoleRejected();
    installFetch({ me: { status: 200, body: HUMAN(1) } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const session = sessionFrom(res);
    expect(session?.level).toBe(3);
    expect(session?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
    expect(session?.consoleCookie).toBeUndefined();
  });

  it('keeps the own-token credential for a modern L1 and binds the verified Console session', async () => {
    consoleAdminVerification();
    installFetch({ me: { status: 200, body: HUMAN(1) } });
    const res = await POST(request({ adminUsername: 'admin', adminPassword: 'admin-pass' }));
    expect(res.status).toBe(200);
    const session = sessionFrom(res);
    // New auth (#214): a verified admin pair does not switch the credential
    // to the server SA token — only the gateway Console cookie is bound.
    expect(session?.level).toBe(3);
    expect(session?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
    expect(session?.consoleCookie).toBe(ADMIN_CONSOLE_COOKIE);
    expect(res.headers.get('set-cookie')).not.toContain('own-matrix-token');
  });

  it('fails closed when a modern L1 supplies invalid admin credentials', async () => {
    consoleAdminVerification();
    installFetch({ me: { status: 200, body: HUMAN(1) } });
    const res = await POST(request({ adminUsername: 'admin', adminPassword: 'wrong-pass' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()).error).toBe('管理员账号验证失败（账号或密码不正确）');
  });

  // ── Pre-1.4 Controller: no /me → legacy fallback ─────────────────────

  it('falls back to the SA Human lookup on a Controller without /me (L1)', async () => {
    vi.mocked(getAuthToken).mockResolvedValue('sa-token');
    consoleRejected();
    const fetchMock = installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 200, body: { name: 'luo', permissionLevel: 1 } },
    });
    const res = await POST(request({ username: 'luo' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe('matrix');
    expect(data.user).toEqual({ username: 'luo', level: 3 });
    // The old Controller rejects L1 Matrix tokens on the data plane: the
    // session rides the server-side SA credential (never the cookie).
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).not.toContain('sa-token');
    expect(cookie).not.toContain('own-matrix-token');
    expect(sessionFrom(res)?.credential).toEqual({ kind: 'sa' });
    // The SA lookup used the server token against the Human endpoint.
    expect(fetchMock).toHaveBeenCalledWith('http://controller.test:8090/api/v1/humans/luo', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer sa-token' }),
    }));
    // The Matrix token is still returned to the client for chat only.
    expect(data.matrix.accessToken).toBe('own-matrix-token');
  });

  it('falls back to the own-token L2 probe when no SA credential is configured', async () => {
    consoleRejected();
    const fetchMock = installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      legacyStatus: 200,
      legacyTeams: { status: 200, teams: [{ name: 'team-a' }, { name: 'team-b' }] },
    });
    const res = await POST(request({ username: 'luo' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toEqual({ username: 'luo', level: 2 });
    const session = sessionFrom(res);
    expect(session?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
    expect(session?.teams).toEqual(['team-a', 'team-b']);
    // No SA token → the SA lookup is skipped entirely.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain(
      expect.stringContaining('/api/v1/humans/'),
    );
    expect(fetchMock).toHaveBeenCalledWith('http://controller.test:8090/api/v1/status', expect.objectContaining({
      headers: { Authorization: 'Bearer own-matrix-token' },
    }));
  });

  it('keeps the L2 credential as the own token on the legacy probe path', async () => {
    // Legacy L2 via own-token probe → matrix credential (A2 chain), never sa.
    vi.mocked(getAuthToken).mockResolvedValue('sa-token');
    consoleRejected();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 404, body: { error: 'not found' } }, // SA lookup fails → probe
      legacyStatus: 200,
    });
    const res = await POST(request({ username: 'luo' }));
    expect(res.status).toBe(200);
    expect(sessionFrom(res)?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
  });

  it('admits a legacy L1 Matrix account through explicit admin verification', async () => {
    consoleAdminVerification();
    const fetchMock = installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 404, body: { error: 'not found' } },
      legacyStatus: 401, // the old Controller rejects the L1 Matrix token
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe('matrix');
    expect(data.user).toEqual({ username: 'luo', level: 3 });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).not.toContain('own-matrix-token');
    const session = sessionFrom(res);
    expect(session?.credential).toEqual({ kind: 'sa' });
    expect(session?.consoleCookie).toBe(ADMIN_CONSOLE_COOKIE);
    // The admin pair was checked against the Console session endpoint; the
    // user's own pair was rejected there first (dual track).
    expect(callHigressConsole).toHaveBeenCalledWith('/session/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin-pass' },
    });
    // The L1 token is still probed so a real L2 Human is not elevated.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      'http://controller.test:8090/api/v1/status',
    );
  });

  it('does not trust the legacy L2 probe over a verified admin pair', async () => {
    // Field case: the old Controller answers 200 on /api/v1/status for an L1
    // Matrix account, so the probe alone would misread "luo" as a team L2
    // user. The explicitly supplied admin pair is authoritative instead.
    vi.mocked(getAuthToken).mockResolvedValue('sa-token');
    consoleAdminVerification();
    const fetchMock = installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 404, body: { error: 'not found' } }, // SA cannot resolve the Human
      legacyStatus: 200, // L2 probe accepts the L1 token
      legacyTeams: { status: 200, teams: [{ name: 'team-a' }] },
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe('matrix');
    expect(data.user).toEqual({ username: 'luo', level: 3 });
    const session = sessionFrom(res);
    // Synthetic legacy L1: SA credential, no team scope, Console session bound.
    expect(session?.crLevel).toBe(1);
    expect(session?.level).toBe(3);
    expect(session?.teams).toEqual([]);
    expect(session?.credential).toEqual({ kind: 'sa' });
    expect(session?.consoleCookie).toBe(ADMIN_CONSOLE_COOKIE);
    expect(res.headers.get('set-cookie')).not.toContain('own-matrix-token');
    expect(callHigressConsole).toHaveBeenCalledWith('/session/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin-pass' },
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      'http://controller.test:8090/api/v1/teams',
    );
  });

  it('rejects an accepted legacy L2 probe when the supplied admin credentials are wrong', async () => {
    consoleAdminVerification();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 404, body: { error: 'not found' } },
      legacyStatus: 200,
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'wrong-pass',
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()).error).toBe('管理员账号验证失败（账号或密码不正确）');
  });

  it('never elevates a legacy L2 Human resolved by the SA lookup', async () => {
    // Authoritative identity (SA Human permissionLevel 2): the admin fields
    // are ignored — an accepted probe and a valid admin pair cannot promote it.
    vi.mocked(getAuthToken).mockResolvedValue('sa-token');
    consoleAdminVerification();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 200, body: { name: 'luo', permissionLevel: 2, accessibleTeams: ['team-a'] } },
      legacyStatus: 200,
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    }));
    expect(res.status).toBe(200);
    const session = sessionFrom(res);
    expect(session?.level).toBe(2);
    expect(session?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
    expect(session?.consoleCookie).toBeUndefined();
    // The admin pair is never verified for a real L2 identity.
    expect(callHigressConsole).toHaveBeenCalledTimes(1);
  });

  it('rejects a legacy L1 when the supplied admin credentials are wrong', async () => {
    consoleAdminVerification();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 404, body: { error: 'not found' } },
      legacyStatus: 401,
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'wrong-pass',
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()).error).toBe('管理员账号验证失败（账号或密码不正确）');
  });

  it('binds the verified Console session for a legacy SA-resolved L1 account', async () => {
    vi.mocked(getAuthToken).mockResolvedValue('sa-token');
    consoleAdminVerification();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 200, body: { name: 'luo', permissionLevel: 1 } },
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    }));
    expect(res.status).toBe(200);
    const session = sessionFrom(res);
    expect(session?.credential).toEqual({ kind: 'sa' });
    expect(session?.consoleCookie).toBe(ADMIN_CONSOLE_COOKIE);
  });

  it('fails closed when a legacy SA-resolved L1 supplies invalid admin credentials', async () => {
    vi.mocked(getAuthToken).mockResolvedValue('sa-token');
    consoleAdminVerification();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      saHuman: { status: 200, body: { name: 'luo', permissionLevel: 1 } },
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'wrong-pass',
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('admits the synthetic L1 over an accepted probe even without an SA credential', async () => {
    // Same override with no SA token configured at all: the SA lookup is
    // skipped, the probe accepts the token, and the verified admin pair is
    // still what decides the level.
    consoleAdminVerification();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      legacyStatus: 200,
      legacyTeams: { status: 200, teams: [{ name: 'team-a' }] },
    });
    const res = await POST(request({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).user).toEqual({ username: 'luo', level: 3 });
    const session = sessionFrom(res);
    expect(session?.crLevel).toBe(1);
    expect(session?.credential).toEqual({ kind: 'sa' });
    expect(session?.consoleCookie).toBe(ADMIN_CONSOLE_COOKIE);
    // One Console call (the user's own, rejected) + the admin verification.
    expect(callHigressConsole).toHaveBeenCalledTimes(2);
  });

  it('rejects when the old Controller cannot verify the identity (no /me, no SA, status 401)', async () => {
    consoleRejected();
    installFetch({
      matrixUserId: '@luo:matrix.local',
      me: { status: 404 },
      legacyStatus: 401,
    });
    const res = await POST(request({ username: 'luo' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    const data = await res.json();
    expect(data.success).toBe(false);
    // Actionable: points at administrator verification or the operational
    // token path / an upgrade.
    expect(data.error).toContain('Controller');
    expect(data.error).toContain('L1 账号管理员验证');
    expect(data.error).toMatch(/token|升级/);
  });

  it('502s when the legacy probe cannot reach any Controller address', async () => {
    consoleRejected();
    installFetch({ me: { status: 404 }, legacyStatus: 'network' });
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('replaces the old 502-without-fallback: a Controller without /me falls back, not fails', async () => {
    consoleRejected();
    installFetch({ me: { status: 404 } }); // no SA, /status 200 → legacy L2
    const res = await POST(request());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toEqual({ username: 'alice', level: 2 });
  });

  // ── Identity rejection / invalid records ─────────────────────────────

  it('rejects identities missing a Human CR', async () => {
    consoleRejected();
    installFetch({ me: { status: 401, body: { error: 'unauthorized' } } });
    const res = await POST(request());
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.status).toBe(401);
  });

  it('does not grant unsupported Human levels', async () => {
    consoleRejected();
    installFetch({ me: { status: 200, body: { name: 'human-alice', permissionLevel: 4, accessibleTeams: [] } } });
    expect((await POST(request())).status).toBe(401);
  });

  it('ignores supplied administrator credentials for an L2 Human', async () => {
    consoleRejected();
    installFetch({ me: { status: 200, body: HUMAN(2) } });
    const res = await POST(request({ adminUsername: 'admin', adminPassword: 'admin-pass' }));
    expect(res.status).toBe(200);
    expect((await res.json()).user.level).toBe(2);
    const session = sessionFrom(res);
    expect(session?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
    expect(session?.consoleCookie).toBeUndefined();
    // The Console track still runs exactly once (dual track); the admin
    // fields are not even verified for an L2 identity — no elevation.
    expect(callHigressConsole).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the session secret is missing', async () => {
    vi.stubEnv('DASHBOARD_SESSION_SECRET', '');
    vi.stubEnv('DASHBOARD_SHARED_MODE', '1');
    consoleRejected();
    installFetch({ me: { status: 200, body: HUMAN(1) } });
    expect((await POST(request())).status).toBe(503);
  });

  it('fails with 401 when both tracks reject the credentials', async () => {
    consoleRejected();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  // ── External mode (upstream #76) — unchanged ─────────────────────────

  it('keeps external Console-only login and never returns a Matrix token', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(callHigressConsole).mockResolvedValue({ response: new Response(null, { status: 200 }), body: {} });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect((await res.json()).matrix).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never creates a Console administrator or falls back to Matrix in external mode', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.mocked(callHigressConsole).mockResolvedValue({ response: new Response(null, { status: 401 }), body: {} });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await POST(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callHigressConsole).toHaveBeenCalledTimes(1);
    expect(callHigressConsole).toHaveBeenCalledWith('/session/login', expect.any(Object));
  });

  // ── Token-only / validation — unchanged ──────────────────────────────

  it('validates required fields', async () => {
    expect((await POST(request({ password: '' }))).status).toBe(400);
  });

  it('retains explicit Controller token-only login as a separate operational path', async () => {
    const fetchMock = vi.fn(async () => Response.json({ humans: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(request({ username: '', password: '', controllerToken: 'operational-token' }));
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe('controller-token');
    expect(fetchMock).toHaveBeenCalledWith('http://controller.test:8090/api/v1/humans?limit=1', expect.objectContaining({ headers: { Authorization: 'Bearer operational-token' } }));
  });

  // ── Set-Cookie follows the request scheme (localhost data-401 fix) ───
  // The request must reach sessionCookieHeader so a Secure flag never rides
  // onto a cookie the browser would then refuse to send back over HTTP.

  it('omits Secure from Set-Cookie on an HTTP login even with DASHBOARD_COOKIE_SECURE=1 (Console track)', async () => {
    vi.stubEnv('DASHBOARD_COOKIE_SECURE', '1');
    consoleOk();
    installFetch();
    const res = await POST(request({ username: 'admin' }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(SESSION_COOKIE_NAME);
    expect(cookie).not.toContain('Secure');
    // The request scheme must not have broken the session itself.
    expect(sessionFrom(res)?.credential).toEqual({ kind: 'sa' });
  });

  it('adds Secure to Set-Cookie when the login request is HTTPS (Console track, DASHBOARD_COOKIE_SECURE=1)', async () => {
    vi.stubEnv('DASHBOARD_COOKIE_SECURE', '1');
    consoleOk();
    installFetch();
    const res = await POST(new NextRequest('https://dashboard.test/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'password' }),
    }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(SESSION_COOKIE_NAME);
    expect(cookie).toContain('Secure');
  });

  it('adds Secure for an HTTPS login request even with DASHBOARD_COOKIE_SECURE unset (scheme-driven)', async () => {
    consoleOk();
    installFetch();
    const res = await POST(new NextRequest('https://dashboard.test/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'password' }),
    }));
    expect(res.status).toBe(200);
    // Without a request the old behavior would omit Secure — this proves
    // the login route forwards the request scheme to the cookie header.
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('omits Secure on an HTTP token-only login even with DASHBOARD_COOKIE_SECURE=1', async () => {
    vi.stubEnv('DASHBOARD_COOKIE_SECURE', '1');
    const fetchMock = vi.fn(async () => Response.json({ humans: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(request({ username: '', password: '', controllerToken: 'operational-token' }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(SESSION_COOKIE_NAME);
    expect(cookie).not.toContain('Secure');
  });

  it('omits Secure on an HTTP Matrix-track login even with DASHBOARD_COOKIE_SECURE=1', async () => {
    vi.stubEnv('DASHBOARD_COOKIE_SECURE', '1');
    consoleRejected();
    installFetch({ me: { status: 200, body: HUMAN(2) } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(SESSION_COOKIE_NAME);
    expect(cookie).not.toContain('Secure');
    expect(sessionFrom(res)?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
  });
});
