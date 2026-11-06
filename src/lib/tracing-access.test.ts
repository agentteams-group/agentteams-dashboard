import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSession, SESSION_COOKIE_NAME, __resetSessionStoreForTests } from './dashboard-session';
import { getTraceScope } from './tracing-access';

vi.mock('@/lib/backend-config', () => ({
  pickBackendUrl: () => null, orderedCandidates: () => [], markWorking: vi.fn(), configFilePath: () => '/tmp/tracing-access-test/config.json',
}));

beforeEach(() => {
  vi.stubEnv('DASHBOARD_SESSION_SECRET', 'a'.repeat(64));
  vi.stubEnv('AGENTTEAMS_API_URL', 'http://controller.local');
  vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'admin-sa');
  vi.stubEnv('AGENTTEAMS_TRACING_DEMO', 'false');
  vi.stubEnv('DASHBOARD_STATELESS', '0');
});
afterEach(() => { __resetSessionStoreForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function userRequest(name: string, token: string) {
  const { cookieValue } = createSession({ user: name, crLevel: 2, credential: { kind: 'matrix', token } });
  return new NextRequest('http://localhost/api/agentteams/traces?controllerUrl=http://other.local', { headers: {
    cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`, 'x-agentteams-user': name, 'x-agentteams-user-level': '2', authorization: 'Bearer forged-admin',
  } });
}

it('uses each account credential and the fixed deployment Controller for its Team and Worker scope', async () => {
  const fetcher = vi.fn().mockImplementation((url: string, options: RequestInit) => {
    expect(url.startsWith('http://controller.local/')).toBe(true);
    const token = new Headers(options.headers).get('authorization');
    const owner = token === 'Bearer token-a' ? 'a' : token === 'Bearer token-b' ? 'b' : 'unexpected';
    expect(owner).not.toBe('unexpected');
    return Promise.resolve(Response.json(url.endsWith('/workers') ? { workers: [{ name: `${owner}-worker`, team: `${owner}-team`, runtime: owner === 'a' ? 'hermes' : 'qwenpaw', env: { SECRET: 'hidden' } }] }
      : { teams: [{ name: `${owner}-team`, teamName: `${owner} team` }] }));
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await getTraceScope(userRequest('alice', 'token-a'))).toEqual({
    teams: [{ name: 'a-team', label: 'a team' }], workers: [{ name: 'a-worker', team: 'a-team', runtime: 'hermes' }],
  });
  expect(await getTraceScope(userRequest('bob', 'token-b'))).toEqual({
    teams: [{ name: 'b-team', label: 'b team' }], workers: [{ name: 'b-worker', team: 'b-team', runtime: 'qwenpaw' }],
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('does not fall back to an admin SA for a scoped user without a live session', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(getTraceScope(new NextRequest('http://localhost/api/agentteams/traces', { headers: {
    'x-agentteams-user': 'alice', 'x-agentteams-user-level': '2',
  } }))).rejects.toMatchObject({ status: 401 });
  expect(fetcher).not.toHaveBeenCalled();
});

it('preserves the user bearer in stateless mode even when an admin SA exists', async () => {
  vi.stubEnv('DASHBOARD_STATELESS', '1');
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, options: RequestInit) => {
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer own-token');
    return Promise.resolve(Response.json(url.endsWith('/workers') ? { workers: [] } : { teams: [] }));
  }));
  expect(await getTraceScope(new NextRequest('http://localhost/api/agentteams/traces', { headers: {
    'x-agentteams-user': 'alice', 'x-agentteams-user-level': '1', authorization: 'Bearer own-token',
  } }))).toEqual({ teams: [], workers: [] });
});

it('fails closed when Controller permission checks fail', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'denied' }, { status: 403 })));
  await expect(getTraceScope(userRequest('alice', 'token-a'))).rejects.toMatchObject({ status: 403 });
});

it('uses an explicit manifest only for the auth-disabled isolated demo', async () => {
  vi.stubEnv('AGENTTEAMS_TRACING_DEMO', 'true'); vi.stubEnv('AGENTTEAMS_AUTH_DISABLED', 'true');
  const scope = { teams: [], workers: [{ name: 'demo', team: '' }] };
  vi.stubEnv('AGENTTEAMS_TRACING_DEMO_SCOPE', JSON.stringify(scope));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const request = new NextRequest('http://localhost/api/agentteams/traces', { headers: { 'x-agentteams-user': 'local', 'x-agentteams-user-level': '3' } });
  expect(await getTraceScope(request)).toEqual(scope);
  vi.stubEnv('AGENTTEAMS_TRACING_DEMO_SCOPE', '');
  await expect(getTraceScope(request)).rejects.toMatchObject({ status: 503 });
  expect(fetcher).not.toHaveBeenCalled();
});
