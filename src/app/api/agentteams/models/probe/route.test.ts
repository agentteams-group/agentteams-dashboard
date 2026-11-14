import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { requireHigressConsoleAccess } from '../../../higress/access';
import { callHigressConsole } from '../../../higress/proxy-helper';

vi.mock('../../../higress/access', () => ({ requireHigressConsoleAccess: vi.fn() }));
vi.mock('../../../higress/proxy-helper', () => ({ callHigressConsole: vi.fn() }));
vi.mock('../../../higress/helpers', async (original) => ({ ...await original<object>(), getSessionCookie: () => '_hi_sess=test-session' }));

const auth = vi.mocked(requireHigressConsoleAccess);
const consoleCall = vi.mocked(callHigressConsole);
const fetchMock = vi.fn();
const request = (body: unknown) => new NextRequest('http://dashboard/api/agentteams/models/probe', { method: 'POST', body: JSON.stringify(body) });
const input = { type: 'qwen', model: 'qwen3.8-max', baseUrl: 'https://models.example/v1', token: 'new-secret' };

describe('model connection probe endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.mockResolvedValue(null);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: 'OK' } }] }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('checks administrator access before reading credentials or contacting upstreams', async () => {
    auth.mockResolvedValue(Response.json({ error: 'Login required' }, { status: 401 }) as never);
    expect((await POST(request(input))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleCall).not.toHaveBeenCalled();
  });

  it('makes a real generation request with the selected model and bounds its output', async () => {
    const result = await (await POST(request(input))).json();
    expect(result).toMatchObject({ success: true, model: 'qwen3.8-max' });
    expect(fetchMock).toHaveBeenCalledWith('https://models.example/v1/chat/completions', expect.objectContaining({ method: 'POST', redirect: 'error' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'qwen3.8-max', max_tokens: 256 });
  });

  it('uses saved credentials only against the saved endpoint, ignoring browser endpoint overrides', async () => {
    consoleCall.mockResolvedValue({ response: Response.json({}), body: { data: { name: 'saved', type: 'openai', tokens: ['saved-secret'], rawConfigs: { openaiCustomUrl: 'https://saved.example/v1', openaiCustomServicePort: 8443 } } } });
    const result = await (await POST(request({ providerName: 'saved', model: 'qwen3.8-max', baseUrl: 'https://attacker.example/v1', token: 'ignored' }))).json();
    expect(consoleCall).toHaveBeenCalledWith('/v1/ai/providers/saved', { cookie: '_hi_sess=test-session' });
    expect(fetchMock).toHaveBeenCalledWith('https://saved.example:8443/v1/chat/completions', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer saved-secret' }) }));
    expect(JSON.stringify(result)).not.toContain('saved-secret');
  });

  it.each([null, [], { ...input, model: 12 }, { ...input, model: '' }, { ...input, baseUrl: 42 }])('rejects malformed input without fetching', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retains the existing private-network guard', async () => {
    expect((await POST(request({ ...input, baseUrl: 'http://127.0.0.1/v1' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose saved secrets echoed in an upstream error', async () => {
    consoleCall.mockResolvedValue({ response: Response.json({}), body: { name: 'saved', type: 'openai', tokens: ['saved-secret'] } });
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'bad credential saved-secret' } }));
    const result = await (await POST(request({ providerName: 'saved', model: 'gpt-6.1-sol' }))).json();
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('saved-secret');
  });

  it('rejects non-JSON success pages and keeps timeout active while reading the body', async () => {
    fetchMock.mockResolvedValue(new Response('<html>login</html>', { status: 200 }));
    expect((await (await POST(request(input))).json()).success).toBe(false);
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (_url, init) => ({ status: 200, text: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) }));
    const response = POST(request(input));
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await (await response).json()).message).toContain('超时');
  });
});
