// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { POST } from './route';
import {
  callHigressConsole,
  forwardCookies,
  getHigressConsoleURL,
  HigressConsoleConfigurationError,
} from '../../higress/proxy-helper';
import { getAuthToken, getControllerUrl } from '../../agentteams/proxy-helper';
import { __resetSessionStoreForTests, SESSION_COOKIE_NAME, validateSessionToken } from '@/lib/dashboard-session';
import { forgetWorking } from '@/lib/backend-config';

vi.mock('../../higress/proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  forwardCookies: vi.fn((from: Headers, to: Headers) => {
    for (const cookie of from.getSetCookie()) {
      to.append('set-cookie', cookie);
    }
  }),
  getHigressConsoleURL: vi.fn(() => 'http://higress-console:8080'),
  // Same class reference the route's instanceof check consumes (module is
  // fully mocked — the real class would never match a thrown mock instance).
  HigressConsoleConfigurationError: class HigressConsoleConfigurationError extends Error {
    constructor(reason: string) {
      super(`Higress Console deployment configuration error: ${reason}`);
    }
  },
  // 12.16: real impl for the server-bound Console session capture.
  collectSetCookieHeader: (h: Headers) =>
    h
      .getSetCookie()
      .map((c: string) => c.split(';')[0].trim())
      .filter((c: string) => c.includes('='))
      .join('; ') || undefined,
}));

vi.mock('../../agentteams/proxy-helper', () => ({
  getAuthToken: vi.fn(async () => 'sa-token'),
  getControllerUrl: vi.fn(() => 'http://controller.test:8090'),
}));

vi.mock('@/lib/homeserver-allowlist', () => ({
  validateHomeserverUrl: vi.fn(),
}));

const mockCallHigressConsole = vi.mocked(callHigressConsole);
const mockForwardCookies = vi.mocked(forwardCookies);
const mockGetAuthToken = vi.mocked(getAuthToken);
const mockGetControllerUrl = vi.mocked(getControllerUrl);
const mockGetHigressConsoleURL = vi.mocked(getHigressConsoleURL);

const SECRET = 'c'.repeat(64);

function request(body: Record<string, unknown>) {
  return new NextRequest('http://dashboard.test/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function successfulConsoleLogin() {
  return {
    response: new Response(null, { status: 200, headers: { 'set-cookie': '_hi_sess=abc; Path=/; HttpOnly' } }),
    body: { success: true },
  };
}

function failedConsoleLogin() {
  return {
    response: new Response(null, { status: 401 }),
    body: { error: 'bad' },
  };
}

/** fetch mock router: SA human lookup + Matrix login, default 401. */
function installFetchMock(opts: {
  humans?: Record<string, { status?: number; body?: Record<string, unknown> }>;
  humansList?: { status?: number; body?: Record<string, unknown> };
  matrixLogin?: { status?: number; body?: Record<string, unknown> };
  teams?: { status?: number; body?: Record<string, unknown> };
  status?: { status?: number; body?: Record<string, unknown> };
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    void init;
    const humanMatch = url.match(/\/api\/v1\/humans\/([^/]+)$/);
    if (humanMatch) {
      const spec = opts.humans?.[decodeURIComponent(humanMatch[1])] ?? { status: 404 };
      return new Response(spec.status ? null : JSON.stringify(spec.body ?? {}), {
        status: spec.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/status')) {
      // Own-matrix-token identity probe — default 401 (token rejected =
      // not an L2 team user); L2 tests pass `status` explicitly.
      const spec = opts.status ?? { status: 401 };
      return new Response(spec.status ? null : JSON.stringify(spec.body ?? { ok: true }), {
        status: spec.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/api/v1/humans')) {
      // verifyControllerToken endpoint — admin-only in the Controller
      // (an L2 Matrix token gets 403 here even though /api/v1/teams
      // returns 200 for it). Default 401 = invalid token; tests asserting
      // a VALID admin token pass `humansList` explicitly.
      const spec = opts.humansList ?? { status: 401 };
      return new Response(spec.status ? null : JSON.stringify(spec.body ?? { humans: [] }), {
        status: spec.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/teams')) {
      // ListTeams — default 401; tests asserting L2 team-scope reads
      // pass `teams` explicitly.
      const spec = opts.teams ?? { status: 401 };
      return new Response(spec.status ? null : JSON.stringify(spec.body ?? { items: [] }), {
        status: spec.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/_matrix/client/v3/login')) {
      const spec = opts.matrixLogin ?? { status: 401 };
      return new Response(spec.status ? null : JSON.stringify(spec.body ?? {}), {
        status: spec.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 401 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function responseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json();
}

describe('POST /api/auth/login (dual track, M19)', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('DASHBOARD_SESSION_SECRET', SECRET);
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'direct');
    vi.stubEnv('DASHBOARD_COOKIE_SECURE', '');
    mockCallHigressConsole.mockReset();
    mockGetHigressConsoleURL.mockReset();
    mockGetHigressConsoleURL.mockReturnValue('http://higress-console:8080');
    mockForwardCookies.mockReset();
    mockGetAuthToken.mockReset();
    mockGetAuthToken.mockResolvedValue('sa-token');
    mockGetControllerUrl.mockReset();
    mockGetControllerUrl.mockReturnValue('http://controller.test:8090');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('L1: Console login → level-3 session, identity = the Console username (admin ≠ carol), SA credential, both cookies', async () => {
    mockCallHigressConsole.mockResolvedValue(successfulConsoleLogin());
    const fetchMock = installFetchMock({ matrixLogin: { status: 401 } });

    const response = await POST(request({ username: 'admin', password: 'password' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.success).toBe(true);
    // Identity is the Console account itself — NOT remapped to a Human CR.
    expect(data.user).toEqual({ username: 'admin', level: 3 });
    expect(data.mode).toBe('higress');
    expect(data.matrix).toBeNull();

    // No Human CR lookup on the Console track.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/api/v1/humans/'))).toBe(true);

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith('_hi_sess='))).toBe(true);
  });

  it('L1: session secret missing → fail closed (503, no cookie)', async () => {
    vi.stubEnv('DASHBOARD_SESSION_SECRET', '');
    mockCallHigressConsole.mockResolvedValue(successfulConsoleLogin());
    installFetchMock({ matrixLogin: { status: 401 } });

    const response = await POST(request({ username: 'admin', password: 'password' }));
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('L1: Console host not on allowlist → 503 deployment-config error, no misleading permission error (maintainer report 9/19)', async () => {
    mockGetHigressConsoleURL.mockImplementation(() => {
      throw new HigressConsoleConfigurationError('Console host "agtmain0918-controller" is not allowed');
    });
    const fetchMock = installFetchMock({ matrixLogin: { status: 200 } });

    const response = await POST(request({ username: 'admin', password: 'password' }));
    expect(response.status).toBe(503);
    const data = await responseJson(response);
    expect(data.success).toBe(false);
    const err = String(data.error);
    expect(err).toContain('部署配置错误');
    expect(err).toContain('agtmain0918-controller');
    expect(err).toContain('AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS');
    // The old behavior funneled this into the Matrix track and surfaced a
    // permission error — assert it is gone.
    expect(err).not.toContain('权限级别');
    // No session cookie, and the Matrix track was never consulted for
    // session data (login endpoint answered before the human lookup).
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/api/v1/humans/'))).toBe(true);
  });

  it('L1: correct Console config + wrong password → plain auth failure (not a deployment-config error)', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({ matrixLogin: { status: 401 } });

    const response = await POST(request({ username: 'admin', password: 'wrong' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(String(data.error)).not.toContain('部署配置错误');
  });

  it('Matrix: Console 401 + Matrix login + CR level 2 (bob) → level-2 session, scoped, matrix mode, no Console cookie', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({
      humans: { bob: { body: { name: 'bob', permissionLevel: 2, accessibleTeams: ['biz-team'] } } },
      matrixLogin: {
        body: { access_token: 'syt_l2_token', user_id: '@bob:sat.example', device_id: 'D1' },
      },
    });

    // L2 users ignore admin credentials (their own Matrix token is the
    // data-plane credential) — passing them must not break the login.
    const response = await POST(
      request({
        username: 'bob',
        password: 'matrix-password',
        adminUsername: 'should-be-ignored',
        adminPassword: 'x',
      }),
    );
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.success).toBe(true);
    expect(data.user).toEqual({ username: 'bob', level: 2 });
    expect(data.mode).toBe('matrix');
    expect((data.matrix as { accessToken?: string }).accessToken).toBe('syt_l2_token');

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith('_hi_sess='))).toBe(false);
    // The Matrix token must never appear in a cookie value.
    expect(cookies.every((c) => !c.includes('syt_l2_token'))).toBe(true);
  });

  it('Console deployment config error (host not allowed) → falls through to the Matrix track instead of 502 (one-person-per-instance LAN deployment)', async () => {
    const cfgError = new Error(
      'Higress Console deployment configuration error: Console host "192.168.1.107" is not allowed',
    );
    cfgError.name = 'HigressConsoleConfigurationError';
    mockGetHigressConsoleURL.mockImplementation(() => {
      throw cfgError;
    });
    installFetchMock({
      humans: { bob: { body: { name: 'bob', permissionLevel: 2, accessibleTeams: ['biz-team'] } } },
      matrixLogin: {
        body: { access_token: 'syt_l2_token', user_id: '@bob:sat.example', device_id: 'D1' },
      },
    });

    const response = await POST(request({ username: 'bob', password: 'matrix-password' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.success).toBe(true);
    expect(data.user).toEqual({ username: 'bob', level: 2 });
    expect(data.mode).toBe('matrix');
  });

  // ── SA-less (one-person-per-instance) identity resolution ──────────────
  // The Controller denies matrix tokens on human reads (authorizeHuman
  // has no "human" case), so without a server-side SA credential:
  // admin token pasted at login → CR read (L1 self-service), otherwise
  // the user's OWN matrix token probes /status — a 200 proves L2 (the
  // controller only accepts level-2 matrix tokens) and /teams returns
  // the user's own accessibleTeams. Plugin model: own token = default
  // identity, no admin credential needed.

  it('SA-less instance: L1 + valid pasted controller token performs the level lookup', async () => {
    mockGetAuthToken.mockResolvedValue(undefined);
    installFetchMock({
      humans: { carol: { body: { name: 'carol', permissionLevel: 1, accessibleTeams: [] } } },
      humansList: { body: { humans: [] } },
      teams: { body: { items: [] } },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D1' },
      },
    });

    const response = await POST(request({ username: 'carol', password: 'matrix-password', controllerToken: 'admin-token-1' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.success).toBe(true);
    expect(data.user).toEqual({ username: 'carol', level: 3 });
    expect(data.mode).toBe('matrix');
  });

  it('SA-less instance: invalid pasted controller token → specific 401, not generic', async () => {
    mockGetAuthToken.mockResolvedValue(undefined);
    installFetchMock({
      humans: { carol: { status: 401 } },
      teams: { status: 401 },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D1' },
      },
    });

    const response = await POST(request({ username: 'carol', password: 'matrix-password', controllerToken: 'bad-token' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.error).toBe('Controller 管理员 token 无效');
  });

  it('SA-less instance: L2 with NO admin token → 200 level 2 via own matrix token (plugin model)', async () => {
    mockGetAuthToken.mockResolvedValue(undefined);
    installFetchMock({
      status: { body: { ok: true } }, // own matrix token accepted → L2 proven
      teams: { body: { teams: [{ name: 'biz-team' }], total: 1 } },
      matrixLogin: {
        body: { access_token: 'syt_l2_token', user_id: '@bob:sat.example', device_id: 'D1' },
      },
    });

    const response = await POST(request({ username: 'bob', password: 'matrix-password' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.success).toBe(true);
    expect(data.user).toEqual({ username: 'bob', level: 2 });
    expect(data.mode).toBe('matrix');
  });

  it('SA-less instance: controller rejects the matrix token (L1/L3) + no admin token → specific 401', async () => {
    mockGetAuthToken.mockResolvedValue(undefined);
    installFetchMock({
      // no `status` key → probe defaults to 401 (token rejected)
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D1' },
      },
    });

    const response = await POST(request({ username: 'carol', password: 'matrix-password' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.error).toBe('无法确认该账号的权限级别：请展开「管理员账号验证」提供 Controller 管理员 token，或联系部署管理员检查 Human CR');
  });

  it('SA-less instance: L2 + valid pasted controller token → level 2 (admin bootstrap)', async () => {
    mockGetAuthToken.mockResolvedValue(undefined);
    installFetchMock({
      humans: { bob: { body: { name: 'bob', permissionLevel: 2, accessibleTeams: ['biz-team'] } } },
      humansList: { body: { humans: [] } },
      teams: { body: { items: [] } },
      matrixLogin: {
        body: { access_token: 'syt_l2_token', user_id: '@bob:sat.example', device_id: 'D1' },
      },
    });

    const response = await POST(request({ username: 'bob', password: 'matrix-password', controllerToken: 'admin-token-1' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.user).toEqual({ username: 'bob', level: 2 });
  });

  it('Matrix: CR level 1 + valid admin account credentials → level-3 session, SA data credential, matrix chat token kept', async () => {
    // First Console call = the user's own (fails → fall through to Matrix);
    // second = the admin account verification (succeeds).
    mockCallHigressConsole
      .mockResolvedValueOnce(failedConsoleLogin())
      .mockResolvedValueOnce(successfulConsoleLogin());
    installFetchMock({
      humans: {
        carol: {
          body: { name: 'carol', permissionLevel: 1, accessibleTeams: ['sysdev-team', 'embedded-team'] },
        },
      },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D2' },
      },
    });

    const response = await POST(
      request({
        username: 'carol',
        password: 'matrix-password',
        adminUsername: 'admin',
        adminPassword: 'admin-password',
      }),
    );
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.success).toBe(true);
    expect(data.user).toEqual({ username: 'carol', level: 3 });
    expect(data.mode).toBe('matrix');
    // The Matrix token is still returned for the chat tab.
    expect((data.matrix as { accessToken?: string }).accessToken).toBe('syt_l1_token');
    // Console was hit twice: user login attempt + admin verification.
    expect(mockCallHigressConsole).toHaveBeenCalledTimes(2);
    expect(mockCallHigressConsole).toHaveBeenLastCalledWith(
      '/session/login',
      expect.objectContaining({ body: { username: 'admin', password: 'admin-password' } }),
    );
    // The admin verification's Console cookie must NOT be forwarded.
    expect(response.headers.getSetCookie().every((c) => !c.startsWith('_hi_sess='))).toBe(true);
    // 12.16: but it IS bound to the dashboard session server-side, so the
    // operator's own login can manage the model gateway.
    const sessionCookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toBeTruthy();
    const value = (sessionCookie as string).split(';')[0].slice(SESSION_COOKIE_NAME.length + 1);
    const boundSession = validateSessionToken(value);
    expect(boundSession?.consoleCookie).toBe('_hi_sess=abc');
  });

  it('Matrix: CR level 1 WITHOUT admin credentials → 400 with a clear hint', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({
      humans: { carol: { body: { name: 'carol', permissionLevel: 1 } } },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D2' },
      },
    });

    const response = await POST(request({ username: 'carol', password: 'matrix-password' }));
    expect(response.status).toBe(400);
    const data = await responseJson(response);
    expect(data.success).toBe(false);
    expect(String(data.error)).toContain('管理员账号');
  });

  it('Matrix: CR level 1 + valid pasted Controller token → level-3 session (plugin admin-token mode), token never in a cookie', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({
      humans: { carol: { body: { name: 'carol', permissionLevel: 1 } } },
      // The token verification hits the admin-only GET /api/v1/humans → 200.
      humansList: { body: { humans: [] } },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D2' },
      },
    });

    const response = await POST(
      request({ username: 'carol', password: 'matrix-password', controllerToken: 'cli-admin-token' }),
    );
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.user).toEqual({ username: 'carol', level: 3 });
    expect(data.mode).toBe('matrix');
    expect((data.matrix as { accessToken?: string }).accessToken).toBe('syt_l1_token');
    expect(response.headers.getSetCookie().every((c) => !c.includes('cli-admin-token'))).toBe(true);
  });

  it('Matrix: CR level 1 + INVALID pasted token → 401', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    // The fetch router's default 401 also answers the /api/v1/humans check →
    // token verification fails.
    installFetchMock({
      humans: { carol: { body: { name: 'carol', permissionLevel: 1 } } },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D2' },
      },
    });

    const response = await POST(
      request({ username: 'carol', password: 'matrix-password', controllerToken: 'wrong-token' }),
    );
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(String(data.error)).toContain('token');
  });

  it('Matrix: CR level 1 + WRONG admin credentials → 401 管理员账号验证失败', async () => {
    // Both Console attempts fail (user + admin).
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({
      humans: { carol: { body: { name: 'carol', permissionLevel: 1 } } },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D2' },
      },
    });

    const response = await POST(
      request({ username: 'carol', password: 'matrix-password', adminUsername: 'admin', adminPassword: 'wrong' }),
    );
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(String(data.error)).toContain('管理员账号验证失败');
  });

  it('Matrix: CR level 3 (observer) → level-1 session', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({
      humans: { watcher: { body: { name: 'watcher', permissionLevel: 3 } } },
      matrixLogin: {
        body: { access_token: 't3', user_id: '@watcher:sat.example', device_id: 'D3' },
      },
    });

    const response = await POST(request({ username: 'watcher', password: 'x' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.user).toEqual({ username: 'watcher', level: 1 });
    expect(data.mode).toBe('matrix');
  });

  it('Matrix: login ok but no Human CR (non-human account) → 401 (no level leak)', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({
      humans: {},
      matrixLogin: {
        body: { access_token: 't', user_id: '@randomuser:sat.example', device_id: 'D' },
      },
    });

    const response = await POST(request({ username: 'randomuser', password: 'x' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.success).toBe(false);
  });

  it('both tracks fail → 401', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({ humans: {}, matrixLogin: { status: 401 } });

    const response = await POST(request({ username: 'nobody', password: 'x' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.success).toBe(false);
  });

  it('never calls /system/init (auto-registration removed — fresh-Console privilege escalation)', async () => {
    mockCallHigressConsole.mockResolvedValue(successfulConsoleLogin());
    installFetchMock({ matrixLogin: { status: 401 } });

    await POST(request({ username: 'admin', password: 'password' }));
    expect(mockCallHigressConsole).toHaveBeenCalledTimes(1);
    expect(mockCallHigressConsole).not.toHaveBeenCalledWith('/system/init', expect.anything());
  });

  it('external mode: no init, no Matrix token returned, session still created for L1', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    mockCallHigressConsole.mockResolvedValue(successfulConsoleLogin());
    installFetchMock({
      matrixLogin: { body: { access_token: 'secret-matrix', user_id: '@admin:sat.example', device_id: 'D' } },
    });

    const response = await POST(request({ username: 'admin', password: 'password' }));
    expect(response.status).toBe(200);
    expect(mockCallHigressConsole).toHaveBeenCalledTimes(1);
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/session/login', expect.anything());
    const data = await responseJson(response);
    expect(data.matrix).toBeNull();
    expect(JSON.stringify(data)).not.toContain('secret-matrix');
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
  });

  it('external mode: Console credential failure does NOT fall through to Matrix (401, no topology/token leak)', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    const fetchMock = installFetchMock({
      // Would-be Matrix-track response if the fall-through still happened.
      matrixLogin: { body: { access_token: 'secret-matrix', user_id: '@admin:sat.example', device_id: 'D' } },
    });

    const response = await POST(request({ username: 'admin', password: 'wrong-password' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.success).toBe(false);
    const serialized = JSON.stringify(data);
    expect(serialized.toLowerCase()).not.toContain('matrix');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('agentteams-controller:6167');
    // The internal homeserver was never probed with the remote client's
    // credentials in external mode.
    const matrixCalls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/_matrix/client/v3/login'));
    expect(matrixCalls).toEqual([]);
  });

  it('post-merge review Block 1: saved matrix address (setup page) is used for login when env is empty (standalone deployment)', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-matrix-cfg-'));
    try {
      const configFile = path.join(dir, 'config.json');
      fs.writeFileSync(
        configFile,
        JSON.stringify({ version: 1, backends: { matrix: { internal: 'http://matrix.custom.test:8448' } } }),
      );
      vi.stubEnv('DASHBOARD_CONFIG_FILE', configFile);
      vi.stubEnv('NEXT_PUBLIC_MATRIX_API_URL', '');
      vi.stubEnv('AGENTTEAMS_MATRIX_URL', '');
      forgetWorking('matrix');
      const fetchMock = installFetchMock({
        humans: { bob: { body: { name: 'bob', permissionLevel: 2, accessibleTeams: ['t1'] } } },
        matrixLogin: {
          body: { access_token: 'syt_cfg_token', user_id: '@bob:custom.test', device_id: 'D1' },
        },
      });

      const response = await POST(request({ username: 'bob', password: 'pw' }));
      expect(response.status).toBe(200);
      const data = await responseJson(response);
      expect(data.mode).toBe('matrix');
      const loginCalls = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/_matrix/client/v3/login'));
      expect(loginCalls).toEqual(['http://matrix.custom.test:8448/_matrix/client/v3/login']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('post-merge review Block 3: a token that only passes /teams (L2) is rejected by the admin-only check', async () => {
    mockGetAuthToken.mockResolvedValue(undefined); // SA-less instance
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    const fetchMock = installFetchMock({
      // The token WOULD pass the old check: ListTeams returns 200 for L2.
      teams: { body: { teams: [] } },
      // ...but the admin-only endpoint (GET /api/v1/humans) denies it.
      humansList: { status: 403 },
      matrixLogin: {
        body: { access_token: 'syt_l1_token', user_id: '@carol:sat.example', device_id: 'D1' },
      },
    });

    const response = await POST(
      request({ username: 'carol', password: 'matrix-password', controllerToken: 'own-l2-matrix-token' }),
    );
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.error).toBe('Controller 管理员 token 无效');
    const adminCheckCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/api/v1/humans'));
    expect(adminCheckCalls.length).toBe(1);
  });

  it('SEC-09: an unexpected internal error returns a generic 502 without internal details', async () => {
    const requestSpy = vi.spyOn(NextRequest.prototype, 'json').mockRejectedValue(
      new Error('DASHBOARD_SESSION_SECRET not configured; fetch ECONNREFUSED 10.0.0.9'),
    );
    try {
      const response = await POST(
        new NextRequest('http://dashboard.test/api/auth/login', {
          method: 'POST',
          body: 'not-json',
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(response.status).toBe(502);
      const data = await responseJson(response);
      expect(data.success).toBe(false);
      const err = String(data.error);
      expect(err).toBe('Login failed due to an internal server error');
      expect(err).not.toContain('DASHBOARD_SESSION_SECRET');
      expect(err).not.toContain('ECONNREFUSED');
    } finally {
      requestSpy.mockRestore();
    }
  });

  // ── Token-only track (no Console admin / no Matrix Human account) ──────
  // Field report: Console 401 + Matrix 403 for the same operator, while the
  // Controller admin token is valid. A single-operator deployment must be
  // able to log in with that token alone.

  it('token-only: valid Controller admin token → 200 level-3 session, mode controller-token, session cookie', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    const fetchMock = installFetchMock({ humansList: { body: { humans: [] } } });

    const response = await POST(request({ controllerToken: 'admin-token-1' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data).toEqual({
      success: true,
      user: { username: 'controller-admin', level: 3 },
      mode: 'controller-token',
    });

    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toBeTruthy();
    const value = (sessionCookie as string).split(';')[0].slice(SESSION_COOKIE_NAME.length + 1);
    const boundSession = validateSessionToken(value);
    expect(boundSession?.level).toBe(3);
    // The token is held server-side only (never in a cookie / response).
    expect(boundSession?.credential).toEqual({ kind: 'controller-token', token: 'admin-token-1' });
    expect(cookies.every((c) => !c.includes('admin-token-1'))).toBe(true);
    expect(JSON.stringify(data)).not.toContain('admin-token-1');

    // Neither the Console nor the Matrix track was touched: only the
    // admin-only Controller verification ran.
    expect(mockCallHigressConsole).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'http://controller.test:8090/api/v1/humans',
    ]);
  });

  it('token-only: invalid token → 401 Controller 管理员 token 无效, no cookie, no session', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({ humansList: { status: 403 } });

    const response = await POST(request({ controllerToken: 'not-an-admin-token' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Controller 管理员 token 无效');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mockCallHigressConsole).not.toHaveBeenCalled();
  });

  it('token-only: username+password present → dual track unchanged (a valid token never short-circuits it)', async () => {
    mockCallHigressConsole.mockResolvedValue(successfulConsoleLogin());
    const fetchMock = installFetchMock({ humansList: { body: { humans: [] } } });

    const response = await POST(request({ username: 'admin', password: 'password', controllerToken: 'admin-token-1' }));
    expect(response.status).toBe(200);
    const data = await responseJson(response);
    expect(data.mode).toBe('higress');
    expect(data.user).toEqual({ username: 'admin', level: 3 });
    // The token was not consumed as a login credential.
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.every((u) => !u.endsWith('/api/v1/humans'))).toBe(true);
  });

  it('token-only: username+password present but both tracks fail → 401, not a silent token login', async () => {
    mockCallHigressConsole.mockResolvedValue(failedConsoleLogin());
    installFetchMock({ humansList: { body: { humans: [] } }, matrixLogin: { status: 401 } });

    const response = await POST(request({ username: 'carol', password: 'wrong', controllerToken: 'admin-token-1' }));
    expect(response.status).toBe(401);
    const data = await responseJson(response);
    expect(data.success).toBe(false);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('token-only: no credentials at all → 400 (token branch requires a token)', async () => {
    installFetchMock({});

    const response = await POST(request({}));
    expect(response.status).toBe(400);
    const data = await responseJson(response);
    expect(data.error).toBe('Username and password are required');
  });
});
