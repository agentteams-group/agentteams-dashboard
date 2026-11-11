// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callControllerGateway } from './controller-helper';
import { callHigressConsole, isFallbackConfigWriteEnabled } from './proxy-helper';
import { createSession, SESSION_COOKIE_NAME, __resetSessionStoreForTests } from '@/lib/dashboard-session';
import * as backendConfig from '@/lib/backend-config';

vi.mock('./proxy-helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proxy-helper')>();
  return { ...actual, callHigressConsole: vi.fn() };
});

const consoleMock = vi.mocked(callHigressConsole);

describe('Controller gateway forwarding', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('DASHBOARD_SESSION_SECRET', 'a'.repeat(64));
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'direct');
    vi.stubEnv('AGENTTEAMS_API_URL', 'http://controller.test:8090');
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'internal-sa-must-not-be-used');
    consoleMock.mockReset();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function request() {
    const { cookieValue } = createSession({ user: 'alice', crLevel: 1, credential: { kind: 'matrix', token: 'alice-token' } });
    return new NextRequest('http://dashboard.test/api/higress/ai-providers', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`, authorization: 'Bearer injected-token' },
    });
  }

  it('uses the user token and fixed Controller route, never the server SA or browser injection', async () => {
    vi.spyOn(backendConfig, 'backendAuthHeader').mockReturnValue({ Authorization: 'Bearer saved-admin-must-not-be-used' });
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ name: 'provider', tokenCount: 2 }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await callControllerGateway(request(), '/v1/ai/providers');
    expect(result.response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('http://controller.test:8090/api/v1/gateway/ai/providers');
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer alice-token');
    expect(headers.has('cookie')).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('internal-sa-must-not-be-used');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('injected-token');
  });

  it('preserves Controller authorization failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'permission denied' }, { status: 403 })));
    expect((await callControllerGateway(request(), '/v1/ai/providers')).response.status).toBe(403);
    expect(consoleMock).not.toHaveBeenCalled();
  });

  it('forwards write bodies without requiring Console cookies', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { name: 'provider', tokenCount: 1 } }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = { name: 'provider', type: 'openai', tokens: ['new-key'] };
    await callControllerGateway(request(), '/v1/ai/providers', { method: 'POST', body });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
  });

  it('does not borrow the server SA when no user session exists', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(callControllerGateway(new NextRequest('http://dashboard.test/'), '/v1/ai/providers')).rejects.toThrow('user credential');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects arbitrary downstream paths', async () => {
    await expect(callControllerGateway(request(), '/session/login')).rejects.toThrow('Unsupported');
  });

  describe('Console fallback', () => {
    function controllerStatus(status: number) {
      const fetchMock = vi.fn(async () => Response.json({ message: 'upstream body' }, { status }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it.each([404, 405, 501])('answers from the Console when the Controller returns %i', async (status) => {
      const fetchMock = controllerStatus(status);
      consoleMock.mockResolvedValue({
        response: Response.json({ data: [{ name: 'openai' }] }),
        body: { data: [{ name: 'openai' }] },
      });

      const result = await callControllerGateway(request(), '/v1/ai/providers');

      expect(result.response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(consoleMock).toHaveBeenCalledWith('/v1/ai/providers', {
        method: 'GET',
        body: undefined,
        cookie: expect.stringContaining(`${SESSION_COOKIE_NAME}=`),
      });
    });

    it.each([401, 403, 500, 502])('does not fall back when the Controller returns %i', async (status) => {
      controllerStatus(status);
      const result = await callControllerGateway(request(), '/v1/ai/providers');
      expect(result.response.status).toBe(status);
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('surfaces a Console 401 instead of disguising it as a proxy failure', async () => {
      controllerStatus(404);
      consoleMock.mockResolvedValue({
        response: Response.json({ message: 'Login required' }, { status: 401 }),
        body: { message: 'Login required' },
      });

      const result = await callControllerGateway(request(), '/v1/ai/providers');

      expect(result.response.status).toBe(401);
      expect(result.body).toEqual({ message: 'Login required' });
    });

    it('sends no Cookie header when the request has no Console session', async () => {
      // Stateless mode carries the Controller token on Authorization, so the
      // fallback really is cookie-less (stateful requests always carry the
      // dashboard session cookie).
      vi.stubEnv('DASHBOARD_STATELESS', '1');
      controllerStatus(404);
      consoleMock.mockResolvedValue({
        response: Response.json({ message: 'A valid Higress Console session is required' }, { status: 401 }),
        body: { message: 'A valid Higress Console session is required' },
      });

      const result = await callControllerGateway(
        new NextRequest('http://dashboard.test/api/higress/ai-providers', {
          headers: { authorization: 'Bearer browser-token' },
        }),
        '/v1/ai/providers',
      );

      expect(result.response.status).toBe(401);
      expect(consoleMock.mock.calls[0][1]?.cookie).toBeNull();
    });

    it('prepares the route payload and keeps the fallbackConfigWritable contract', async () => {
      controllerStatus(404);
      consoleMock.mockResolvedValue({
        response: Response.json({ data: { name: 'team-chat' } }, { status: 201 }),
        body: { data: { name: 'team-chat' } },
      });
      const body = {
        name: 'team-chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [{ provider: 'openai', weight: 100 }],
        fallbackConfig: { enabled: true },
      };

      const result = await callControllerGateway(request(), '/v1/ai/routes', { method: 'POST', body });

      const forwarded = consoleMock.mock.calls[0][1]?.body as Record<string, unknown>;
      expect(consoleMock).toHaveBeenCalledWith('/v1/ai/routes', expect.objectContaining({
        method: 'POST',
        cookie: expect.any(String),
      }));
      if (!isFallbackConfigWriteEnabled()) expect(forwarded).not.toHaveProperty('fallbackConfig');
      expect((result.body as Record<string, unknown>).fallbackConfigWritable).toBe(isFallbackConfigWriteEnabled());
    });
  });
});
