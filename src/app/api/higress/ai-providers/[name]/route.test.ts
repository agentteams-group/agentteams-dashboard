import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, PUT } from './route';
import { callHigressConsole } from '../../proxy-helper';
import { requireHigressConsoleAccess } from '../../access';

vi.mock('../../proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  higressErrorResponse: vi.fn((response: Response, body: unknown) => Response.json(body, { status: response.status })),
  higressProxyErrorResponse: vi.fn(() => Response.json({ error: 'proxy failed' }, { status: 502 })),
}));

vi.mock('../../access', () => ({ requireHigressConsoleAccess: vi.fn() }));

const mockCallHigressConsole = vi.mocked(callHigressConsole);
const mockRequireAccess = vi.mocked(requireHigressConsoleAccess);
const params = { params: Promise.resolve({ name: 'provider/a' }) };

describe('AI provider item route', () => {
  afterEach(() => {
    vi.resetAllMocks();
    mockRequireAccess.mockResolvedValue(null);
  });

  it('uses the URL provider name when an update omits it', async () => {
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      body: { name: 'provider/a', tokens: ['secret'] },
    });
    const payload = { type: 'openai', protocol: 'openai/v1' };

    const response = await PUT(new NextRequest('http://dashboard.test/api/higress/ai-providers/provider%2Fa', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }), params);

    expect(response.status).toBe(200);
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/providers/provider%2Fa', {
      method: 'PUT',
      body: { ...payload, name: 'provider/a' },
      cookie: null,
    });
    await expect(response.json()).resolves.toEqual({ name: 'provider/a', tokenCount: 1 });
  });

  it('deletes the encoded provider resource', async () => {
    mockCallHigressConsole.mockResolvedValue({
      response: new Response(null, { status: 204 }),
      body: null,
    });

    const response = await DELETE(new NextRequest('http://dashboard.test/api/higress/ai-providers/provider%2Fa', {
      method: 'DELETE',
      headers: { cookie: 'higress_session=session-value' },
    }), params);

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/v1/ai/providers/provider%2Fa', {
      method: 'DELETE',
      cookie: 'higress_session=session-value',
    });
  });
});
