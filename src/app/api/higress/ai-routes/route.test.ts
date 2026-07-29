import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { callHigressConsole, isFallbackConfigWriteEnabled, prepareAiRoutePayload } from '../proxy-helper';
import { requireHigressConsoleAccess } from '../access';

vi.mock('../proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  higressErrorResponse: vi.fn((response: Response, body: unknown) => Response.json(body, { status: response.status })),
  higressProxyErrorResponse: vi.fn(() => Response.json({ error: 'proxy failed' }, { status: 502 })),
  isFallbackConfigWriteEnabled: vi.fn(() => true),
  prepareAiRoutePayload: vi.fn((payload: Record<string, unknown>) => payload),
}));

vi.mock('../access', () => ({ requireHigressConsoleAccess: vi.fn() }));

const mockCallHigressConsole = vi.mocked(callHigressConsole);
const mockRequireAccess = vi.mocked(requireHigressConsoleAccess);
const mockIsFallbackConfigWriteEnabled = vi.mocked(isFallbackConfigWriteEnabled);
const mockPrepareAiRoutePayload = vi.mocked(prepareAiRoutePayload);

describe('AI route collection route', () => {
  afterEach(() => {
    vi.resetAllMocks();
    mockRequireAccess.mockResolvedValue(null);
    mockIsFallbackConfigWriteEnabled.mockReturnValue(true);
  });

  it('lists routes with fallback write capability and forwards the session cookie', async () => {
    mockIsFallbackConfigWriteEnabled.mockReturnValue(false);
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      body: { routes: [{ name: 'team-chat' }] },
    });

    const response = await GET(new NextRequest('http://dashboard.test/api/higress/ai-routes', {
      headers: { cookie: 'higress_session=session-value' },
    }));

    await expect(response.json()).resolves.toEqual({
      routes: [{ name: 'team-chat' }],
      fallbackConfigWritable: false,
    });
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/routes', {
      method: 'GET',
      cookie: 'higress_session=session-value',
    });
  });

  it('unwraps the standard Higress data envelope', async () => {
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      body: { success: true, data: [{ name: 'team-chat' }] },
    });

    const response = await GET(new NextRequest('http://dashboard.test/api/higress/ai-routes'));

    await expect(response.json()).resolves.toEqual({
      routes: [{ name: 'team-chat' }],
      fallbackConfigWritable: true,
    });
  });

  it('validates invalid routes before writing to the Console', async () => {
    const response = await POST(new NextRequest('http://dashboard.test/api/higress/ai-routes', {
      method: 'POST',
      body: JSON.stringify({ name: 'team-chat', upstreams: [] }),
    }));

    expect(response.status).toBe(400);
    expect(mockCallHigressConsole).not.toHaveBeenCalled();
  });

  it('prepares valid routes before forwarding them to the Console', async () => {
    const route = {
      name: 'team-chat',
      pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
      upstreams: [{ provider: 'openai', weight: 100 }],
    };
    mockPrepareAiRoutePayload.mockReturnValue({ ...route, fallbackConfig: { maxRetries: 2 } });
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 201 }),
      body: { name: 'team-chat' },
    });

    const response = await POST(new NextRequest('http://dashboard.test/api/higress/ai-routes', {
      method: 'POST',
      headers: { cookie: 'higress_session=session-value' },
      body: JSON.stringify(route),
    }));

    expect(response.status).toBe(201);
    expect(mockPrepareAiRoutePayload).toHaveBeenCalledWith(route);
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/routes', {
      method: 'POST',
      body: { ...route, fallbackConfig: { maxRetries: 2 } },
      cookie: 'higress_session=session-value',
    });
  });
});
