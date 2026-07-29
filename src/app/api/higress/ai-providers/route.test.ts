import { describe, expect, it, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { callHigressConsole } from '../proxy-helper';
import { requireHigressConsoleAccess } from '../access';

vi.mock('../proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  higressErrorResponse: vi.fn((response: Response, body: unknown) => Response.json(body, { status: response.status })),
  higressProxyErrorResponse: vi.fn(() => Response.json({ error: 'proxy failed' }, { status: 502 })),
}));

vi.mock('../access', () => ({ requireHigressConsoleAccess: vi.fn() }));

const mockCallHigressConsole = vi.mocked(callHigressConsole);
const mockRequireAccess = vi.mocked(requireHigressConsoleAccess);

describe('AI provider collection route', () => {
  afterEach(() => {
    vi.resetAllMocks();
    mockRequireAccess.mockResolvedValue(null);
  });

  it('masks provider tokens and forwards the session cookie', async () => {
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      body: { providers: [{ name: 'openai', type: 'openai', tokens: ['secret-a', 'secret-b'] }] },
    });

    const response = await GET(new NextRequest('http://dashboard.test/api/higress/ai-providers', {
      headers: { cookie: 'higress_session=session-value' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers: [{ name: 'openai', type: 'openai', tokenCount: 2 }],
    });
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/providers', {
      method: 'GET',
      cookie: 'higress_session=session-value',
    });
  });

  it('unwraps the standard Higress data envelope for list and create responses', async () => {
    mockCallHigressConsole
      .mockResolvedValueOnce({
        response: new Response(null, { status: 200 }),
        body: { success: true, data: [{ name: 'openai', type: 'openai', tokens: ['secret'] }] },
      })
      .mockResolvedValueOnce({
        response: new Response(null, { status: 201 }),
        body: { success: true, data: { name: 'deepseek', type: 'deepseek', tokens: ['secret'] } },
      });

    const listResponse = await GET(new NextRequest('http://dashboard.test/api/higress/ai-providers'));
    const createResponse = await POST(new NextRequest('http://dashboard.test/api/higress/ai-providers', {
      method: 'POST',
      body: JSON.stringify({ name: 'deepseek', type: 'deepseek', tokens: ['secret'] }),
    }));

    await expect(listResponse.json()).resolves.toEqual({
      providers: [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    });
    await expect(createResponse.json()).resolves.toEqual({
      name: 'deepseek', type: 'deepseek', tokenCount: 1,
    });
  });

  it('rejects invalid provider payloads before calling the Console', async () => {
    const response = await POST(new NextRequest('http://dashboard.test/api/higress/ai-providers', {
      method: 'POST',
      body: JSON.stringify({ name: 'openai', type: 'openai', tokens: [] }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: '至少需要一个凭据' });
    expect(mockCallHigressConsole).not.toHaveBeenCalled();
  });

  it('maps Console failures without exposing provider tokens', async () => {
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 409 }),
      body: { error: 'provider already exists' },
    });

    const response = await POST(new NextRequest('http://dashboard.test/api/higress/ai-providers', {
      method: 'POST',
      body: JSON.stringify({ name: 'openai', type: 'openai', tokens: ['secret-token'] }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'provider already exists' });
  });
});
