// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { encodeSpeechWav } from '@/lib/speech-audio';

const fetchMock = vi.fn();

function request(level = '2', audio = encodeSpeechWav(new Float32Array(16000))) {
  return new NextRequest('http://localhost/api/agentteams/speech/', {
    method: 'POST',
    headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': level, 'content-type': 'audio/wav' },
    body: audio,
  });
}

beforeEach(() => {
  vi.stubEnv('DASHBOARD_SPEECH_DASHSCOPE_API_KEY', 'server-only-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('speech API', () => {
  it('requires authenticated identity and denies observers on the paid path', async () => {
    expect((await GET(new NextRequest('http://localhost/api/agentteams/speech/'))).status).toBe(401);
    expect((await POST(request('1'))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes availability without returning credentials', async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ dashscopeAvailable: true });
    vi.stubEnv('DASHBOARD_SPEECH_DASHSCOPE_API_KEY', '');
    expect(await (await GET(request())).json()).toEqual({ dashscopeAvailable: false });
    expect((await POST(request())).status).toBe(503);
  });

  it('accepts bounded WAV audio and uses only the server credential', async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: ' 请检查 Nacos 配置。 ' } }] }));
    const req = request();
    req.headers.set('authorization', 'Bearer browser-token');
    expect(await (await POST(req)).json()).toEqual({ text: '请检查 Nacos 配置。' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer server-only-secret');
    const payload = JSON.parse(options.body);
    expect(payload.model).toBe('qwen3-asr-flash');
    expect(payload.asr_options).toEqual({ language: 'zh' });
    expect(payload.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,UklGR/);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects invalid and oversized input before calling the provider', async () => {
    expect((await POST(request('2', new ArrayBuffer(44)))).status).toBe(400);
    const req = request();
    req.headers.set('content-length', '99999999');
    expect((await POST(req)).status).toBe(413);
    const wrongType = request();
    wrongType.headers.set('content-type', 'text/plain');
    expect((await POST(wrongType)).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports rate limits, timeouts and empty results without leaking upstream payloads', async () => {
    fetchMock.mockResolvedValueOnce(new Response('server-only-secret', { status: 429 }));
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(await limited.text()).not.toContain('server-only-secret');
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    expect((await POST(request())).status).toBe(504);
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '' } }] }));
    expect((await POST(request())).status).toBe(422);
  });

  it('omits the language hint for auto detection and rejects unsupported languages', async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: 'hello' } }] }));
    const req = request();
    req.nextUrl.searchParams.set('language', 'auto');
    expect((await POST(req)).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).asr_options).toBeUndefined();
    const invalid = request();
    invalid.nextUrl.searchParams.set('language', 'unknown');
    expect((await POST(invalid)).status).toBe(400);
  });
});
