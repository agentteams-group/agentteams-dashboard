import { describe, expect, it } from 'vitest';
import {
  LLM_TUNING_FIELDS,
  diffLlmTuning,
  findLlmTuningError,
  pickLlmTuning,
  pickLlmTuningSet,
  validateLlmTuningValue,
} from './llm-tuning';

describe('llm-tuning metadata', () => {
  it('涵盖 issue 要求的四类参数（重试 / 并发 / 首段 / 中断）', () => {
    const keys = LLM_TUNING_FIELDS.map((f) => f.key);
    expect(keys).toContain('llmMaxRetries');
    expect(keys).toContain('llmMaxConcurrent');
    expect(keys).toContain('llmStreamFirstContentTimeout');
    expect(keys).toContain('llmStreamIdleTimeout');
  });
});

describe('validateLlmTuningValue', () => {
  it.each(['', ' ', '0', '3', '1.5', '300'])('合法：%s', (v) => {
    expect(validateLlmTuningValue(v)).toBeNull();
  });

  it.each(['-1', 'abc', '1.2.3', '1e3'])('非法：%s', (v) => {
    expect(validateLlmTuningValue(v)).not.toBeNull();
  });
});

describe('pickLlmTuning / pickLlmTuningSet', () => {
  it('pickLlmTuning：缺省与非字符串 → 空串', () => {
    const out = pickLlmTuning({ llmMaxRetries: '5', llmMaxConcurrent: 20 as unknown as string });
    expect(out.llmMaxRetries).toBe('5');
    expect(out.llmMaxConcurrent).toBe('');
    expect(out.llmStreamIdleTimeout).toBe('');
  });

  it('pickLlmTuningSet：仅保留非空字段', () => {
    const out = pickLlmTuningSet({ llmMaxRetries: '5', llmMaxConcurrent: '', llmMaxQpm: '0' });
    expect(out).toEqual({ llmMaxRetries: '5', llmMaxQpm: '0' });
  });
});

describe('diffLlmTuning', () => {
  it('仅收集变化字段（含清空）', () => {
    const current = pickLlmTuning({ llmMaxRetries: '3', llmMaxConcurrent: '10' });
    const draft = { ...current, llmMaxRetries: '7', llmMaxConcurrent: '' };
    expect(diffLlmTuning(current, draft)).toEqual({ llmMaxRetries: '7', llmMaxConcurrent: '' });
  });

  it('无变化 → 空 diff', () => {
    const current = pickLlmTuning({ llmMaxRetries: '3' });
    expect(diffLlmTuning(current, { ...current })).toEqual({});
  });
});

describe('findLlmTuningError', () => {
  it('返回首个非法字段', () => {
    const draft = pickLlmTuning({ llmMaxRetries: '3' });
    expect(findLlmTuningError(draft)).toBeNull();
    const bad = { ...draft, llmBackoffBase: '-2' };
    expect(findLlmTuningError(bad)?.key).toBe('llmBackoffBase');
  });
});
