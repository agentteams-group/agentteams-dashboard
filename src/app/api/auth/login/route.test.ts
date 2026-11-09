// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { callHigressConsole } from '../../higress/proxy-helper';
import { __resetSessionStoreForTests, SESSION_COOKIE_NAME, getSessionFromRequest } from '@/lib/dashboard-session';

vi.mock('../../higress/proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  forwardCookies: vi.fn(),
  getHigressConsoleURL: vi.fn(() => 'http://higress-console:8080'),
  HigressConsoleConfigurationError: class extends Error {},
}));
vi.mock('../../agentteams/proxy-helper', () => ({
  getControllerUrl: vi.fn(() => 'http://controller.test:8090'),
}));
vi.mock('@/lib/homeserver-allowlist', () => ({ validateHomeserverUrl: vi.fn() }));

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://dashboard.test/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username: 'alice', password: 'password', ...extra }),
  });
}

function installFetch(level: number, status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/_matrix/client/v3/login')) return Response.json({
      access_token: 'own-matrix-token', user_id: '@alice:matrix.local', device_id: 'device',
    });
    if (url.endsWith('/api/v1/me')) return Response.json({
      name: 'human-alice', permissionLevel: level, accessibleTeams: ['team-a'],
    }, { status });
    throw new Error('Unexpected privileged lookup: ' + url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Human login through Controller', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('DASHBOARD_SESSION_SECRET', 'c'.repeat(64));
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'direct');
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'must-not-be-used');
    vi.mocked(callHigressConsole).mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  for (const [crLevel, level] of [[1, 3], [2, 2], [3, 1]]) {
    it('logs in Human level ' + crLevel + ' with only its own credentials', async () => {
      const fetchMock = installFetch(crLevel);
      const res = await POST(request());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user).toEqual({ username: 'human-alice', level });
      expect(data.matrix.accessToken).toBe('own-matrix-token');
      const cookie = res.headers.get('set-cookie')!;
      expect(cookie).not.toContain('own-matrix-token');
      expect(cookie).not.toContain('must-not-be-used');
      const session = getSessionFromRequest(new NextRequest('http://dashboard.test/', {
        headers: { cookie: cookie.split(';')[0] },
      }));
      expect(session?.credential).toEqual({ kind: 'matrix', token: 'own-matrix-token' });
      expect(session?.consoleCookie).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith('http://controller.test:8090/api/v1/me', expect.objectContaining({
        headers: { Authorization: 'Bearer own-matrix-token' },
      }));
      expect(callHigressConsole).not.toHaveBeenCalled();
      expect(cookie).toContain(SESSION_COOKIE_NAME);
    });
  }

  it('ignores supplied administrator credentials during Human login', async () => {
    installFetch(2);
    const res = await POST(request({ controllerToken: 'admin-token', adminUsername: 'admin', adminPassword: 'secret' }));
    expect((await res.json()).user.level).toBe(2);
    expect(callHigressConsole).not.toHaveBeenCalled();
  });

  it('does not grant unsupported Human levels', async () => {
    installFetch(4);
    expect((await POST(request())).status).toBe(401);
  });

  it('reports an old Controller explicitly without falling back to an admin credential', async () => {
    installFetch(1, 404);
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('升级 Controller');
    expect(callHigressConsole).not.toHaveBeenCalled();
  });

  it('rejects identities missing a Human CR', async () => {
    installFetch(1, 401);
    const res = await POST(request());
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.status).toBe(401);
  });

  it('fails closed when the session secret is missing', async () => {
    vi.stubEnv('DASHBOARD_SESSION_SECRET', '');
    vi.stubEnv('DASHBOARD_SHARED_MODE', '1');
    installFetch(1);
    expect((await POST(request())).status).toBe(503);
  });

  it('rejects bad Matrix passwords without contacting Higress', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    expect((await POST(request())).status).toBe(401);
    expect(callHigressConsole).not.toHaveBeenCalled();
  });

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
});
