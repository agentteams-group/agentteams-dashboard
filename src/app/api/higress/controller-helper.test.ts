// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callControllerGateway } from './controller-helper';
import { createSession, SESSION_COOKIE_NAME, __resetSessionStoreForTests } from '@/lib/dashboard-session';
import * as backendConfig from '@/lib/backend-config';

describe('Controller gateway forwarding', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('DASHBOARD_SESSION_SECRET', 'a'.repeat(64));
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'direct');
    vi.stubEnv('AGENTTEAMS_API_URL', 'http://controller.test:8090');
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'internal-sa-must-not-be-used');
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
});
