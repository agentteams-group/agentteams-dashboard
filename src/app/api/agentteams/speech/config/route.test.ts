// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { GET, PUT } from './route';
import { GET as availability, POST as transcribe } from '../route';
import { encodeSpeechWav } from '@/lib/speech-audio';

let directory: string;
const fetchMock = vi.fn();
function request(level: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (level) { headers['x-agentteams-user'] = 'alice'; headers['x-agentteams-user-level'] = level; }
  return new NextRequest('http://localhost/api/agentteams/speech/config/', {
    method: body === undefined ? 'GET' : 'PUT', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const settings = { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-asr-flash' };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'speech-config-'));
  vi.stubEnv('DASHBOARD_CONFIG_FILE', join(directory, 'config.json'));
  vi.stubEnv('DASHBOARD_SPEECH_DASHSCOPE_API_KEY', '');
  vi.stubEnv('DASHBOARD_SPEECH_DASHSCOPE_BASE_URL', '');
  vi.stubEnv('DASHBOARD_SPEECH_DASHSCOPE_MODEL', '');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('speech settings API', () => {
  it('requires an administrator for both reading and changing configuration', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await GET(request('2'))).status).toBe(403);
    expect((await PUT(request('2', settings))).status).toBe(403);
  });

  it('persists the key privately, masks responses and preserves it when editing other fields', async () => {
    const saved = await PUT(request('3', { ...settings, apiKey: 'private-speech-key' }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ...settings, apiKeyConfigured: true });
    expect((await GET(request('3'))).headers.get('cache-control')).toBe('no-store');
    expect(await (await GET(request('3'))).text()).not.toContain('private-speech-key');
    await PUT(request('3', { ...settings, model: 'qwen3-asr-flash-new' }));
    const disk = JSON.parse(await readFile(join(directory, 'speech.json'), 'utf8'));
    expect(disk.apiKey).toBe('private-speech-key');
    expect(disk.model).toBe('qwen3-asr-flash-new');
    expect((await stat(join(directory, 'speech.json'))).mode & 0o777).toBe(0o600);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses saved configuration immediately for transcription and can clear an env-sourced key', async () => {
    vi.stubEnv('DASHBOARD_SPEECH_DASHSCOPE_API_KEY', 'environment-key');
    await PUT(request('3', { ...settings, apiKey: 'saved-key' }));
    expect(await (await availability(request('2'))).json()).toEqual({ dashscopeAvailable: true });
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: '测试' } }] }));
    const req = new NextRequest('http://localhost/api/agentteams/speech/', {
      method: 'POST', headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '2', 'content-type': 'audio/wav' },
      body: encodeSpeechWav(new Float32Array(16000)),
    });
    expect((await transcribe(req)).status).toBe(200);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer saved-key');
    expect(await (await PUT(request('3', { ...settings, clearApiKey: true }))).json()).toEqual({ ...settings, apiKeyConfigured: false });
    expect(await (await availability(request('2'))).json()).toEqual({ dashscopeAvailable: false });
  });

  it('rejects invalid endpoints and requires a new key when changing credential destination', async () => {
    for (const baseUrl of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?token=key']) {
      expect((await PUT(request('3', { ...settings, baseUrl, apiKey: 'key' }))).status).toBe(400);
    }
    await PUT(request('3', { ...settings, apiKey: 'key' }));
    expect((await PUT(request('3', { ...settings, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }))).status).toBe(400);
    expect((await PUT(request('3', { ...settings, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', apiKey: 'new-key' }))).status).toBe(200);
  });
});
