import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeClientBearerToken,
  installClientAuthFetch,
  __resetClientAuthFetchForTests,
} from './client-auth-fetch';
import { useMatrixStore } from './matrix-store';
import { useAgentTeamsStore } from './agentteams-store';
import { saveClientConfig, clearClientConfig } from './client-config-store';

function mockLocation(search = '') {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'http://localhost',
      href: `http://localhost/${search ? `?${search}` : ''}`,
      search,
      replace,
    },
  });
  return replace;
}

describe('activeClientBearerToken (F7 client credential priority)', () => {
  beforeEach(() => {
    clearClientConfig();
    useMatrixStore.getState().logout();
  });

  it('returns null with no stored credentials', () => {
    expect(activeClientBearerToken()).toBeNull();
  });

  it('prefers the at_cfg controller_token (L1 full view) over the matrix token', () => {
    useMatrixStore.getState().setMatrixAuth({ homeserver: 'http://hs:6867', userId: '@u:hs', deviceId: 'DEV', accessToken: 'matrix-tok' });
    saveClientConfig({
      matrix_homeservers: [],
      controller_urls: [],
      controller_token: 'l1-token',
      sglang: { enabled: false, urls: [] },
    });
    expect(activeClientBearerToken()).toBe('l1-token');
  });

  it('falls back to the matrix-store token when no controller_token', () => {
    useMatrixStore.getState().setMatrixAuth({ homeserver: 'http://hs:6867', userId: '@u:hs', deviceId: 'DEV', accessToken: 'matrix-tok' });
    saveClientConfig({
      matrix_homeservers: [],
      controller_urls: [],
      controller_token: '',
      sglang: { enabled: false, urls: [] },
    });
    expect(activeClientBearerToken()).toBe('matrix-tok');
  });

  it('ignores a stale matrix token when logged out', () => {
    useMatrixStore.getState().logout();
    expect(activeClientBearerToken()).toBeNull();
  });
});

describe('installClientAuthFetch (F7 fetch patch)', () => {
  // The spy IS the network: the patch captures window.fetch at install time,
  // so the spy must exist before installClientAuthFetch() and all assertions
  // read the spy's call log (window.fetch is the patch itself afterwards).
  let network: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetClientAuthFetchForTests();
    useAgentTeamsStore.setState({ sessionUser: null });
    mockLocation();
    clearClientConfig();
    useMatrixStore.getState().setMatrixAuth({
      homeserver: 'http://hs:6867',
      accessToken: 'matrix-tok',
      userId: '@u:hs',
      deviceId: 'DEV',
    });
    network = vi.spyOn(window, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
    installClientAuthFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function lastInit(): { headers: Headers } {
    return network.mock.calls[network.mock.calls.length - 1][1] as { headers: Headers };
  }

  function urls(): string[] {
    return network.mock.calls.map((call: unknown[]) => {
      const input = call[0] as RequestInfo | URL;
      return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    });
  }

  it('injects the bearer into /api/agentteams/* when no header is present', async () => {
    await window.fetch('/api/agentteams/teams');
    expect(lastInit().headers.get('authorization')).toBe('Bearer matrix-tok');
  });

  it('never overrides an existing Authorization header (chat passes its own)', async () => {
    await window.fetch('/api/matrix/sync', { headers: { authorization: 'Bearer chat-token' } });
    expect(lastInit().headers.get('authorization')).toBe('Bearer chat-token');
  });

  it('ignores non-data-plane and cross-origin URLs', async () => {
    await window.fetch('/api/matrix/sync');
    expect(lastInit().headers.get('authorization')).toBeNull();
    expect(lastInit().headers.get('x-agentteams-homeserver')).toBeNull();
  });

  it('injects the logged-in homeserver for the server identity probe', async () => {
    await window.fetch('/api/agentteams/teams');
    expect(lastInit().headers.get('x-agentteams-homeserver')).toBe('http://hs:6867');
  });

  it('on a data-plane 401: clears the server session, then the matrix credential, then bounces once', async () => {
    const replace = (window.location as unknown as { replace: ReturnType<typeof vi.fn> }).replace;
    let replaceCallsAtLogout = -1;
    network.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/logout')) replaceCallsAtLogout = replace.mock.calls.length;
      return new Response('unauthorized', { status: 401 });
    });

    await window.fetch('/api/agentteams/teams');

    const logoutCall = network.mock.calls.find((call: unknown[]) => {
      const input = call[0] as RequestInfo | URL;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes('/api/auth/logout');
    });
    expect(logoutCall).toBeDefined();
    const logoutInit = logoutCall![1] as RequestInit;
    expect(logoutInit.method).toBe('POST');
    expect(logoutInit.credentials).toBe('same-origin');
    // the HttpOnly session cookie is cleared BEFORE the page reloads, else
    // the reloaded page authenticates again and the bounce loops forever.
    expect(replaceCallsAtLogout).toBe(0);
    expect(useMatrixStore.getState().isLoggedIn).toBe(false);
    expect(useMatrixStore.getState().accessToken).toBe('');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/?reason=unauthorized&from=data401');
    expect(window.sessionStorage.getItem('at_auth_bounce_at')).not.toBeNull();
  });

  it('does not bounce a second time within 10s (hands the 401 back to the caller)', async () => {
    // Simulates the reloaded page: the in-realm `redirecting` flag is gone,
    // but the sessionStorage bounce timestamp survives.
    window.sessionStorage.setItem('at_auth_bounce_at', String(Date.now()));
    network.mockImplementation(async () => new Response('still unauthorized', { status: 401 }));
    const replace = window.location.replace;

    const res = await window.fetch('/api/agentteams/teams');

    expect(res.status).toBe(401);
    expect(replace).not.toHaveBeenCalled();
    // credentials stay intact: the page decides what to show, we do not
    // silently log the user out on a repeated 401.
    expect(useMatrixStore.getState().isLoggedIn).toBe(true);
    const logoutCalls = network.mock.calls.filter((call: unknown[]) => {
      const input = call[0] as RequestInfo | URL;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes('/api/auth/logout');
    });
    expect(logoutCalls).toHaveLength(0);
  });

  it('keeps a valid session when an upstream request answers 401 (skills permission)', async () => {
    network.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) return Response.json({ authenticated: true, username: 'alice', level: 2 });
      return Response.json({ error: 'forbidden', detail: 'skills are not permitted' }, { status: 401 });
    });
    const replace = (window.location as unknown as { replace: ReturnType<typeof vi.fn> }).replace;

    const res = await window.fetch('/api/agentteams/workers/w1/skills');

    // The 401 is handed to the page; the credential stays intact.
    expect(res.status).toBe(401);
    expect(replace).not.toHaveBeenCalled();
    expect(useMatrixStore.getState().isLoggedIn).toBe(true);
    expect(urls().some((url) => url.includes('/api/auth/logout'))).toBe(false);
    // The authoritative session probe was consulted before deciding.
    expect(urls().some((url) => url.includes('/api/auth/session'))).toBe(true);
  });

  it('clears the session when /api/auth/session confirms the credential is dead', async () => {
    network.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) return Response.json({ authenticated: false });
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    });
    const replace = (window.location as unknown as { replace: ReturnType<typeof vi.fn> }).replace;

    await window.fetch('/api/agentteams/teams');

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/?reason=unauthorized&from=data401');
    expect(useMatrixStore.getState().isLoggedIn).toBe(false);
    expect(urls().some((url) => url.includes('/api/auth/logout'))).toBe(true);
  });

  it('does not log out when the session probe itself is unavailable and the body is not a session error', async () => {
    network.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) return new Response('upstream down', { status: 503 });
      return Response.json({ error: 'forbidden' }, { status: 401 });
    });
    const replace = (window.location as unknown as { replace: ReturnType<typeof vi.fn> }).replace;

    const res = await window.fetch('/api/agentteams/workers/w1/skills');

    expect(res.status).toBe(401);
    expect(replace).not.toHaveBeenCalled();
    expect(useMatrixStore.getState().isLoggedIn).toBe(true);
    expect(urls().some((url) => url.includes('/api/auth/logout'))).toBe(false);
  });

  it('does not bounce on 401 from /api/auth/* (login form keeps its inline error)', async () => {
    network.mockImplementation(async () => new Response('bad password', { status: 401 }));
    const replace = (window.location as unknown as { replace: ReturnType<typeof vi.fn> }).replace;
    await window.fetch('/api/auth/login', { method: 'POST' });
    expect(replace).not.toHaveBeenCalled();
    expect(useMatrixStore.getState().isLoggedIn).toBe(true);
  });

  it('does not reload the login form when the anonymous reconnect probe receives 401', async () => {
    useMatrixStore.getState().logout();
    network.mockImplementation(async () => new Response('unauthorized', { status: 401 }));
    const replace = (window.location as unknown as { replace: ReturnType<typeof vi.fn> }).replace;
    await window.fetch('/api/agentteams/healthz/');
    expect(replace).not.toHaveBeenCalled();
  });

  it('still redirects an expired stateful session without a browser bearer token', async () => {
    useMatrixStore.getState().logout();
    useAgentTeamsStore.setState({ sessionUser: 'admin' });
    network.mockImplementation(async () => new Response('unauthorized', { status: 401 }));
    await window.fetch('/api/agentteams/teams');
    expect(window.location.replace).toHaveBeenCalledWith('/?reason=unauthorized&from=data401');
  });

  it('does not let an anonymous in-flight probe log out a newly authenticated user', async () => {
    useMatrixStore.getState().logout();
    network.mockImplementation(async () => {
      useAgentTeamsStore.setState({ sessionUser: 'admin' });
      return new Response('unauthorized', { status: 401 });
    });
    await window.fetch('/api/agentteams/healthz/');
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});
