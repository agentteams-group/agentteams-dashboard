import { describe, expect, it } from 'vitest';
import { buildModelProbe, evaluateModelProbe, redactProbeError } from './model-connection-probe';

describe('model connection probes', () => {
  it.each(['qwen3.8-max', 'kimi-k3.1-pro', 'glm-5.3'])('generates a bounded chat request for %s', (model) => {
    const probe = buildModelProbe({ model, type: 'custom', baseUrl: 'https://models.example/v1/', token: 'secret' });
    expect(probe.url).toBe('https://models.example/v1/chat/completions');
    expect(probe.body).toMatchObject({ model, max_tokens: 256, stream: false });
  });

  it('uses current MiniMax parameters and limits thinking for short probes', () => {
    expect(buildModelProbe({ model: 'MiniMax-M3', type: 'minimax', token: 'key' }).body).toMatchObject({ max_completion_tokens: 256, thinking: { type: 'disabled' } });
    const flash = buildModelProbe({ model: 'MiniMax-M3.1-Flash', type: 'minimax', token: 'key' }).body;
    expect(flash).toMatchObject({ max_completion_tokens: 256, reasoning_effort: 'low' });
    expect(flash).not.toHaveProperty('thinking');
    expect(flash).not.toHaveProperty('max_tokens');
  });

  it('uses the selected model rather than a hardcoded native model', () => {
    const claude = buildModelProbe({ model: 'claude-sonnet-4-6', type: 'claude', protocol: 'original', token: 'key' });
    expect(claude.url).toBe('https://api.anthropic.com/v1/messages');
    expect(claude.headers['x-api-key']).toBe('key');
    expect(claude.body.model).toBe('claude-sonnet-4-6');
    const gemini = buildModelProbe({ model: 'gemini-4-carbon', type: 'gemini', protocol: 'original', token: 'key' });
    expect(gemini.url).toContain('/models/gemini-4-carbon:generateContent');
    expect(gemini.headers['x-goog-api-key']).toBe('key');
    expect(gemini.url).not.toContain('key');
  });

  it('does not treat HTTP 200 business errors or empty choices as a working model', () => {
    expect(evaluateModelProbe(200, { error: { message: 'bad model' } }, []).success).toBe(false);
    expect(evaluateModelProbe(200, { base_resp: { status_code: 1004, status_msg: 'bad key' } }, []).success).toBe(false);
    expect(evaluateModelProbe(200, { choices: [{ message: { content: '' } }] }, []).success).toBe(false);
  });

  it.each([
    { choices: [{ message: { content: 'OK' } }] },
    { content: [{ type: 'text', text: 'OK' }] },
    { candidates: [{ content: { parts: [{ text: 'OK' }] } }] },
    { choices: [{ message: { reasoning_content: 'Thinking' } }] },
  ])('recognizes generated text or reasoning', (value) => {
    expect(evaluateModelProbe(200, value, []).success).toBe(true);
  });

  it('distinguishes permission, missing model and rate-limit failures and masks echoed credentials', () => {
    expect(evaluateModelProbe(403, {}, []).message).toContain('权限或额度');
    expect(evaluateModelProbe(404, {}, []).message).toContain('模型不存在');
    expect(evaluateModelProbe(429, {}, []).message).toContain('限流');
    const result = evaluateModelProbe(401, { error: { message: 'invalid key my-private-key, Bearer another-secret' } }, ['my-private-key']);
    expect(result.message).not.toContain('my-private-key');
    expect(result.message).not.toContain('another-secret');
    expect(redactProbeError('sk-sensitive-key', [])).not.toContain('sensitive');
  });
});
