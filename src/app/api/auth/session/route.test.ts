// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { validateHigressCookieString, validateHigressSession } from '@/lib/api-auth';

// 12.15：路由对 Higress 会话做真实校验（Console 探测）——测试按默认
// 「无有效会话」mock，逐用例可覆写。
vi.mock('@/lib/api-auth', () => ({
  validateHigressSession: vi.fn(async () => ({ valid: false, user: null })),
  validateHigressCookieString: vi.fn(async () => ({ valid: false, user: null })),
}));
import {
  SESSION_COOKIE_NAME,
  __resetSessionStoreForTests,
  createSession,
} from '@/lib/dashboard-session';

const SECRET = 'a1'.repeat(32);

function requestWith(cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest('http://dashboard.test/api/auth/session', { headers });
}

describe('GET /api/auth/session (M19 dashboard session)', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    process.env.DASHBOARD_SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    __resetSessionStoreForTests();
    delete process.env.DASHBOARD_SESSION_SECRET;
    vi.unstubAllGlobals();
  });

  it('reports unauthenticated without a session cookie', async () => {
    const data = await (await GET(requestWith())).json();
    expect(data).toEqual({ authenticated: false });
  });

  it('reports the L1 (Console) session as level 3 / higress mode', async () => {
    const { cookieValue } = createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
    const data = await (await GET(requestWith(`${SESSION_COOKIE_NAME}=${cookieValue}`))).json();
    expect(data).toEqual({
      authenticated: true,
      username: 'carol',
      level: 3,
      mode: 'higress',
      higressSession: false,
    });
  });

  it('reports the L2 (Matrix) session as level 2 / matrix mode with the human name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ name: 'bob', permissionLevel: 2, accessibleTeams: ['biz-team'] })));
    const { cookieValue } = createSession({
      user: 'bob',
      crLevel: 2,
      teams: ['biz-team'],
      credential: { kind: 'matrix', token: 'syt_secret' },
    });
    const res = await GET(requestWith(`${SESSION_COOKIE_NAME}=${cookieValue}`));
    const data = await res.json();
    expect(data).toEqual({
      authenticated: true,
      username: 'bob',
      level: 2,
      mode: 'matrix',
      higressSession: false,
    });
    // The Matrix token must never leave the server.
    expect(JSON.stringify(data)).not.toContain('syt_secret');
  });

  it('reports higressSession true when the browser holds a valid Console session', async () => {
    vi.mocked(validateHigressSession).mockResolvedValueOnce({
      valid: true,
      user: { name: 'admin', level: 3 },
    });
    const { cookieValue } = createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
    const data = await (
      await GET(requestWith(`${SESSION_COOKIE_NAME}=${cookieValue}; _hi_sess=abc`))
    ).json();
    expect(data.higressSession).toBe(true);
  });

  it('reports higressSession true for a server-bound Console session (L1 + admin verification)', async () => {
    vi.mocked(validateHigressSession).mockResolvedValueOnce({ valid: false, user: null });
    vi.mocked(validateHigressCookieString).mockResolvedValueOnce({
      valid: true,
      user: { name: 'admin', level: 3 },
    });
    const { cookieValue } = createSession({
      user: 'luo',
      crLevel: 1,
      credential: { kind: 'sa' },
      consoleCookie: '_hi_sess=abc',
    });
    const data = await (await GET(requestWith(`${SESSION_COOKIE_NAME}=${cookieValue}`))).json();
    expect(data.higressSession).toBe(true);
    expect(validateHigressCookieString).toHaveBeenCalledWith('_hi_sess=abc');
  });

  it('ignores unrelated cookies (no session cookie present)', async () => {
    const data = await (await GET(requestWith('_hi_sess=abc'))).json();
    expect(data).toEqual({ authenticated: false });
  });

  it('refreshes a downgraded Human session from Controller without a Console probe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ name: 'alice', permissionLevel: 2, accessibleTeams: [] })));
    const { cookieValue } = createSession({ user: 'alice', crLevel: 1, credential: { kind: 'matrix', token: 'alice-token' } });
    const data = await (await GET(requestWith(`${SESSION_COOKIE_NAME}=${cookieValue}`))).json();
    expect(data.level).toBe(2);
    expect(data.higressSession).toBe(false);
  });

  it('does not treat a revoked Human identity as authenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const { cookieValue } = createSession({ user: 'alice', crLevel: 1, credential: { kind: 'matrix', token: 'alice-token' } });
    expect(await (await GET(requestWith(`${SESSION_COOKIE_NAME}=${cookieValue}`))).json()).toEqual({ authenticated: false });
  });
});
