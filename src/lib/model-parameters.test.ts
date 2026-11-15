import { describe, expect, it } from 'vitest';
import { commonReasoningEfforts, readModelRequestParameters, serializeModelRequestParameters, validateModelRequestParameters } from './model-parameters';

describe('model connection parameters', () => {
  const defaults = { maxTokens: '', outputTokenParameter: 'max_tokens' as const, reasoningEffort: '' };

  it('leaves defaults unset and selects the correct output parameter for OpenAI reasoning models', () => {
    expect(serializeModelRequestParameters([], defaults)).toEqual([]);
    expect(readModelRequestParameters([], ['gpt-6.1-sol']).outputTokenParameter).toBe('max_completion_tokens');
  });

  it('offers only reasoning levels shared by all models, and none for unknown models', () => {
    expect(commonReasoningEfforts(['qwen4-max-preview'])).toEqual(['low', 'medium', 'xhigh']);
    expect(commonReasoningEfforts(['MiniMax-M3.1-Flash', 'glm-5.3'])).toEqual(['low', 'high', 'max']);
    expect(commonReasoningEfforts(['glm-5.3', 'private-model'])).toEqual([]);
  });

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])('rejects invalid output budget %s', (maxTokens) => {
    expect(validateModelRequestParameters({ ...defaults, maxTokens }, [], 'openai/v1')).not.toEqual([]);
  });

  it('rejects output beyond known capacity, incompatible levels and unsupported protocols', () => {
    expect(validateModelRequestParameters({ ...defaults, maxTokens: '393217' }, ['qwen4-max-preview'], 'openai/v1')[0]).toContain('393,216');
    expect(validateModelRequestParameters({ ...defaults, reasoningEffort: 'medium' }, ['glm-5.3'], 'openai/v1')[0]).toContain('不共同支持');
    expect(validateModelRequestParameters({ ...defaults, maxTokens: '4096' }, [], 'original')[0]).toContain('仅支持');
  });

  it('replaces managed settings, preserves other settings, and clears overrides when fields are emptied', () => {
    const existing = [{ name: 'temperature', value: 0.8, overwrite: false }, { name: 'max_tokens', value: 12 }, { name: 'reasoning_effort', value: 'high' }];
    const next = serializeModelRequestParameters(existing, { ...defaults, maxTokens: '8192', outputTokenParameter: 'max_completion_tokens', reasoningEffort: 'max' });
    expect(next).toEqual([existing[0], { name: 'max_completion_tokens', value: 8192, mode: 'raw', overwrite: true }, { name: 'reasoning_effort', value: 'max', mode: 'raw', overwrite: true }]);
    expect(readModelRequestParameters(next, [])).toEqual({ maxTokens: '8192', outputTokenParameter: 'max_completion_tokens', reasoningEffort: 'max' });
    expect(serializeModelRequestParameters(next, defaults)).toEqual([existing[0]]);
  });
});
