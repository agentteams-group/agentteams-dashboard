// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_CACHE_TTL_MS,
  __resetSessionStoreForTests,
  createSession,
  validateSessionToken,
} from '@/lib/dashboard-session';
import { reverifyDashboardSession } from './identity-revalidation';

vi.mock('@/lib/api-auth', () => ({
  validateHigressCookieString: vi.fn(),
}));

import { validateHigressCookieString } from '@/lib/api-auth';

const SECRET = 'b2'.repeat(32);

beforeEach(() => {
  __resetSessionStoreForTests();
  process.env.DASHBOARD_SESSION_SECRET = SECRET;
  vi.mocked(validateHigressCookieString).mockReset();
});

afterEach(() => {
  __resetSessionStoreForTests();
  delete process.env.DASHBOARD_SESSION_SECRET;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SEC-05 identity revalidation', () => {
  it('reuses a short cache for ordinary requests and refreshes scoped Human data after expiry', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      name: 'alice', permissionLevel: 2,
      accessibleTeams: [{ name: 'team-a' }], accessibleWorkers: [{ name: 'worker-a' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { cookieValue } = createSession({
      user: 'alice', crLevel: 1, teams: [], workers: [],
      credential: { kind: 'matrix', token: 'matrix-secret' },
    });
    const session = validateSessionToken(cookieValue)!;
    expect(await reverifyDashboardSession(session)).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + IDENTITY_CACHE_TTL_MS + 1);
    expect(await reverifyDashboardSession(session)).toEqual({ ok: true });
    expect(session.level).toBe(2);
    expect(session.teams).toEqual(['team-a']);
    expect(session.workers).toEqual(['worker-a']);
  });

  it('forces sensitive requests to upstream even inside the cache window', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ name: 'alice', permissionLevel: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const { cookieValue } = createSession({
      user: 'alice', crLevel: 1, credential: { kind: 'matrix', token: 'matrix-secret' },
    });
    expect(await reverifyDashboardSession(validateSessionToken(cookieValue)!, { forceRefresh: true })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/me');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer matrix-secret' });
  });

  it('destroys a revoked session and fails closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const { cookieValue } = createSession({
      user: 'alice', crLevel: 1, credential: { kind: 'matrix', token: 'revoked' },
    });
    expect(await reverifyDashboardSession(validateSessionToken(cookieValue)!, { forceRefresh: true })).toMatchObject({ ok: 'invalid' });
    expect(validateSessionToken(cookieValue)).toBeNull();
  });

  it('does not authenticate when the identity provider is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { cookieValue } = createSession({
      user: 'alice', crLevel: 1, credential: { kind: 'matrix', token: 'matrix-secret' },
    });
    expect(await reverifyDashboardSession(validateSessionToken(cookieValue)!, { forceRefresh: true })).toMatchObject({ ok: 'unavailable' });
  });

  it('revalidates a bound Console cookie rather than treating the legacy SA as privileged', async () => {
    vi.mocked(validateHigressCookieString).mockResolvedValue({ valid: false, unavailable: true, user: null });
    const { cookieValue } = createSession({
      user: 'alice', crLevel: 1, credential: { kind: 'sa' }, consoleCookie: '_hi_sess=bound',
    });
    expect(await reverifyDashboardSession(validateSessionToken(cookieValue)!, { forceRefresh: true })).toMatchObject({ ok: 'unavailable' });
    expect(validateHigressCookieString).toHaveBeenCalledWith('_hi_sess=bound', { forceRefresh: true });
  });

  it('refuses sensitive legacy-SA sessions that have no upstream identity', async () => {
    const { cookieValue } = createSession({ user: 'legacy', crLevel: 1, credential: { kind: 'sa' } });
    expect(await reverifyDashboardSession(validateSessionToken(cookieValue)!, { forceRefresh: true })).toMatchObject({ ok: 'unavailable' });
  });
});
