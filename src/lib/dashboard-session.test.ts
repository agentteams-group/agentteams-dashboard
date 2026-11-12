import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import {
  SESSION_COOKIE_NAME,
  __resetSessionStoreForTests,
  clearSessionCookieHeader,
  createSession,
  destroySession,
  getSessionFromRequest,
  mapCrLevelToDashLevel,
  parseCookies,
  sessionCookieHeader,
  validateSessionToken,
} from './dashboard-session';

const SECRET = 'a'.repeat(64);

function fakeRequest(cookieHeader: string | null) {
  return { headers: { get: (name: string) => (name.toLowerCase() === 'cookie' ? cookieHeader : null) } };
}

beforeEach(() => {
  __resetSessionStoreForTests();
  process.env.DASHBOARD_SESSION_SECRET = SECRET;
  delete process.env.DASHBOARD_COOKIE_SECURE;
});

describe('mapCrLevelToDashLevel (E5 inversion)', () => {
  it('maps CRD 1 (L1) to dashboard Admin 3', () => expect(mapCrLevelToDashLevel(1)).toBe(3));
  it('maps CRD 2 (L2) to dashboard Operator 2', () => expect(mapCrLevelToDashLevel(2)).toBe(2));
  it('maps CRD 3 (L3) to dashboard Observer 1', () => expect(mapCrLevelToDashLevel(3)).toBe(1));
  it('maps unknown levels down to Observer 1 (fail-safe)', () => {
    expect(mapCrLevelToDashLevel(0)).toBe(1);
    expect(mapCrLevelToDashLevel(99)).toBe(1);
  });
});

describe('createSession / validateSessionToken', () => {
  it('round-trips user, mapped level, teams and credential', () => {
    const { sessionId, cookieValue } = createSession({
      user: 'bob',
      crLevel: 2,
      teams: ['biz-team'],
      credential: { kind: 'matrix', token: 'syt_token_x' },
    });
    expect(sessionId).toHaveLength(64);
    const session = validateSessionToken(cookieValue);
    expect(session).not.toBeNull();
    expect(session?.user).toBe('bob');
    expect(session?.level).toBe(2);
    expect(session?.crLevel).toBe(2);
    expect(session?.teams).toEqual(['biz-team']);
    expect(session?.credential).toEqual({ kind: 'matrix', token: 'syt_token_x' });
  });

  it('maps L1 (CRD 1) to dashboard level 3 with SA credential', () => {
    const { cookieValue } = createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
    expect(validateSessionToken(cookieValue)?.level).toBe(3);
    expect(validateSessionToken(cookieValue)?.credential).toEqual({ kind: 'sa' });
  });

  it('rejects a tampered payload', () => {
    const { cookieValue } = createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
    const [encoded] = cookieValue.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ sid: (JSON.parse(Buffer.from(encoded, 'base64url').toString()) as { sid: string }).sid, user: 'carol', iat: Date.now(), exp: Date.now() + 100000 }),
    ).toString('base64url');
    expect(validateSessionToken(`${tampered}.${cookieValue.split('.')[1]}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const { cookieValue } = createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
    const encoded = cookieValue.split('.')[0];
    const otherSig = createHmac('sha256', 'b'.repeat(64)).update(encoded).digest('base64url');
    expect(validateSessionToken(`${encoded}.${otherSig}`)).toBeNull();
  });

  it('rejects an expired token (valid signature, past exp)', () => {
    const payload = JSON.stringify({ sid: randomBytes(32).toString('hex'), user: 'carol', iat: 1, exp: 2 });
    const encoded = Buffer.from(payload).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url');
    expect(validateSessionToken(`${encoded}.${signature}`)).toBeNull();
  });

  it('rejects a session destroyed server-side even with a valid cookie', () => {
    const { sessionId, cookieValue } = createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
    destroySession(sessionId);
    expect(validateSessionToken(cookieValue)).toBeNull();
  });

  it('never returns a token in the cookie value (tokens stay server-side)', () => {
    const { cookieValue } = createSession({
      user: 'bob',
      crLevel: 2,
      credential: { kind: 'matrix', token: 'SECRET_MATRIX_TOKEN' },
    });
    expect(cookieValue).not.toContain('SECRET_MATRIX_TOKEN');
  });
});

describe('store identity across module instances (middleware vs route bundles)', () => {
  // Next.js bundles the middleware chunk and the app-router chunk separately:
  // each gets its own module instance of this file. If the session store were
  // plain module-level state, the middleware could never see a session created
  // by the login route (and every data request would 401 with a valid cookie).
  // The store must live on globalThis so all bundles in the standalone node
  // process share one instance.
  it('a session created in one module instance validates in another', async () => {
    const modA = await import('./dashboard-session');
    // Vitest cache-bust suffix: forces a second module instance (simulates
    // the middleware bundle vs the app-router bundle in the standalone server).
    // @ts-expect-error query-suffixed specifier is not resolvable by tsc
    const modB = await import('./dashboard-session?instance=2');
    const { cookieValue } = modA.createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
    expect(modB.validateSessionToken(cookieValue)).not.toBeNull();
    // Logout in one bundle must be visible in the other.
    const second = modA.createSession({ user: 'bob', crLevel: 2, credential: { kind: 'matrix', token: 't' } });
    modA.destroySession(second.sessionId);
    expect(modB.validateSessionToken(second.cookieValue)).toBeNull();
  });
});

describe('secret handling (fail closed)', () => {
  it('refuses to create sessions without DASHBOARD_SESSION_SECRET', () => {
    delete process.env.DASHBOARD_SESSION_SECRET;
    expect(() => createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } })).toThrow();
  });

  it('refuses short secrets (< 32 bytes hex)', () => {
    process.env.DASHBOARD_SESSION_SECRET = 'short';
    expect(() => createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } })).toThrow();
    expect(validateSessionToken('x.y')).toBeNull();
  });
});

describe('cookie plumbing', () => {
  it('parses a Cookie header and resolves the session from a request', () => {
    const { cookieValue } = createSession({ user: 'alice', crLevel: 2, teams: ['market-team'], credential: { kind: 'matrix', token: 't' } });
    const session = getSessionFromRequest(fakeRequest(`other=1; ${SESSION_COOKIE_NAME}=${cookieValue}`));
    expect(session?.user).toBe('alice');
    expect(session?.teams).toEqual(['market-team']);
  });

  it('returns null when the cookie is absent', () => {
    expect(getSessionFromRequest(fakeRequest(null))).toBeNull();
    expect(getSessionFromRequest(fakeRequest('unrelated=1'))).toBeNull();
  });

  it('builds HttpOnly/SameSite=Lax cookies without Secure by default (LAN HTTP)', () => {
    const header = sessionCookieHeader('abc.def');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure');
  });

  it('adds Secure only when DASHBOARD_COOKIE_SECURE=1', () => {
    process.env.DASHBOARD_COOKIE_SECURE = '1';
    expect(sessionCookieHeader('abc.def')).toContain('Secure');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(clearSessionCookieHeader()).toContain('Max-Age=0');
  });

  it('parseCookies trims and decodes', () => {
    expect(parseCookies(' a = b%40c ; d=e ')).toEqual({ a: 'b@c', d: 'e' });
  });
});

describe('cookie Secure flag follows the request scheme (localhost data-401 fix)', () => {
  function schemeRequest(scheme: 'http' | 'https', headers: Record<string, string> = {}) {
    return { headers: new Headers(headers), nextUrl: { protocol: `${scheme}:` } };
  }

  it('omits Secure for an HTTP request even with DASHBOARD_COOKIE_SECURE=1', () => {
    process.env.DASHBOARD_COOKIE_SECURE = '1';
    const header = sessionCookieHeader('abc.def', schemeRequest('http'));
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure');
  });

  it('adds Secure for an HTTPS request when DASHBOARD_COOKIE_SECURE=1', () => {
    process.env.DASHBOARD_COOKIE_SECURE = '1';
    expect(sessionCookieHeader('abc.def', schemeRequest('https'))).toContain('Secure');
  });

  it('adds Secure for an HTTPS request when DASHBOARD_COOKIE_SECURE is unset', () => {
    expect(sessionCookieHeader('abc.def', schemeRequest('https'))).toContain('Secure');
  });

  it('never adds Secure when DASHBOARD_COOKIE_SECURE=0, even on HTTPS', () => {
    process.env.DASHBOARD_COOKIE_SECURE = '0';
    expect(sessionCookieHeader('abc.def', schemeRequest('https'))).not.toContain('Secure');
    expect(sessionCookieHeader('abc.def', schemeRequest('http'))).not.toContain('Secure');
  });

  it('trusts x-forwarded-proto: https over an HTTP nextUrl (TLS-terminating proxy)', () => {
    process.env.DASHBOARD_COOKIE_SECURE = '1';
    const header = sessionCookieHeader('abc.def', schemeRequest('http', { 'x-forwarded-proto': 'https' }));
    expect(header).toContain('Secure');
  });

  it('keeps the old env-based behavior when no request is passed (backward compat)', () => {
    process.env.DASHBOARD_COOKIE_SECURE = '1';
    expect(sessionCookieHeader('abc.def')).toContain('Secure');
    delete process.env.DASHBOARD_COOKIE_SECURE;
    expect(sessionCookieHeader('abc.def')).not.toContain('Secure');
  });
});
