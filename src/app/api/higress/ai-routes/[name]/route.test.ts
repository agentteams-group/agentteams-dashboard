import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, PUT } from './route';
import { callHigressConsole, isFallbackConfigWriteEnabled, prepareAiRoutePayload } from '../../proxy-helper';
import { requireHigressConsoleAccess } from '../../access';

vi.mock('../../proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  higressErrorResponse: vi.fn((response: Response, body: unknown) => Response.json(body, { status: response.status })),
  higressProxyErrorResponse: vi.fn((error: unknown) => Response.json({ success: false, error: error instanceof Error ? error.message : 'proxy failed' }, { status: 502 })),
  isFallbackConfigWriteEnabled: vi.fn(() => true),
  prepareAiRoutePayload: vi.fn((payload: Record<string, unknown>) => payload),
}));

vi.mock('../../access', () => ({ requireHigressConsoleAccess: vi.fn() }));

const mockCallHigressConsole = vi.mocked(callHigressConsole);
const mockRequireAccess = vi.mocked(requireHigressConsoleAccess);
const mockIsFallbackConfigWriteEnabled = vi.mocked(isFallbackConfigWriteEnabled);
const mockPrepareAiRoutePayload = vi.mocked(prepareAiRoutePayload);
const params = { params: Promise.resolve({ name: 'team/chat' }) };
const route = {
  name: 'team/chat',
  pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
  upstreams: [{ provider: 'openai', weight: 100 }],
};

describe('AI route item route', () => {
  afterEach(() => {
    vi.resetAllMocks();
    mockRequireAccess.mockResolvedValue(null);
    mockIsFallbackConfigWriteEnabled.mockReturnValue(true);
  });

  it('gets an encoded route and returns fallback write capability', async () => {
    mockIsFallbackConfigWriteEnabled.mockReturnValue(false);
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      body: { name: 'team/chat' },
    });

    const response = await GET(new NextRequest('http://dashboard.test/api/higress/ai-routes/team%2Fchat', {
      headers: { cookie: 'higress_session=session-value' },
    }), params);

    await expect(response.json()).resolves.toEqual({ name: 'team/chat', fallbackConfigWritable: false });
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/routes/team%2Fchat', {
      method: 'GET',
      cookie: 'higress_session=session-value',
    });
  });

  it('prepares a valid route update and preserves its session cookie', async () => {
    mockPrepareAiRoutePayload.mockReturnValue({ ...route, fallbackConfig: { maxRetries: 2 } });
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      body: { name: 'team/chat' },
    });

    const response = await PUT(new NextRequest('http://dashboard.test/api/higress/ai-routes/team%2Fchat', {
      method: 'PUT',
      headers: { cookie: 'higress_session=session-value' },
      body: JSON.stringify(route),
    }), params);

    expect(response.status).toBe(200);
    expect(mockPrepareAiRoutePayload).toHaveBeenCalledWith(route);
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/routes/team%2Fchat', {
      method: 'PUT',
      body: { ...route, fallbackConfig: { maxRetries: 2 } },
      cookie: 'higress_session=session-value',
    });
  });

  it('returns Console errors and maps request timeouts to 502', async () => {
    mockCallHigressConsole.mockResolvedValueOnce({
      response: new Response(null, { status: 409 }),
      body: { error: 'route already exists' },
    });
    const conflict = await PUT(new NextRequest('http://dashboard.test/api/higress/ai-routes/team%2Fchat', {
      method: 'PUT',
      body: JSON.stringify(route),
    }), params);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: 'route already exists' });

    mockCallHigressConsole.mockRejectedValueOnce(new Error('Request timeout'));
    const timeout = await DELETE(new NextRequest('http://dashboard.test/api/higress/ai-routes/team%2Fchat', {
      method: 'DELETE',
    }), params);
    expect(timeout.status).toBe(502);
    await expect(timeout.json()).resolves.toEqual({ success: false, error: 'Request timeout' });
  });

  it('deletes an encoded route resource', async () => {
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 204 }),
      body: null,
    });

    const response = await DELETE(new NextRequest('http://dashboard.test/api/higress/ai-routes/team%2Fchat', {
      method: 'DELETE',
    }), params);

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/routes/team%2Fchat', {
      method: 'DELETE',
      cookie: null,
    });
  });
});
