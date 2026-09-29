import { describe, expect, it } from 'vitest';
import { RUNTIME_META, getRuntimeMeta } from './runtime-meta';
import { RUNTIME_LABELS } from './phase-colors';

describe('runtime metadata', () => {
  it('exposes a Chinese label for every supported runtime', () => {
    for (const [runtime, label] of Object.entries(RUNTIME_LABELS)) {
      expect(typeof label, `label for ${runtime}`).toBe('string');
      expect(label.length, `label for ${runtime}`).toBeGreaterThan(0);
    }
  });

  it('returns a complete meta entry for every runtime in the WorkerRuntime union', () => {
    for (const runtime of Object.keys(RUNTIME_META) as Array<keyof typeof RUNTIME_META>) {
      const meta = RUNTIME_META[runtime];
      expect(meta.icon, `icon for ${runtime}`).toBeDefined();
      expect(meta.badgeClass, `badgeClass for ${runtime}`).toMatch(/^bg-/);
      expect(meta.description, `description for ${runtime}`).toBeTruthy();
    }
  });

  it('recognises the experimental DeepSeek harness runtime end-to-end', () => {
    expect(RUNTIME_LABELS['deepseek-harness']).toBe('DeepSeek Harness');
    const meta = getRuntimeMeta('deepseek-harness');
    expect(meta).not.toBeNull();
    expect(meta?.description).toMatch(/DeepSeek/);
  });

  it('marks leftover CoPaw instances as upgrade-only', () => {
    const meta = getRuntimeMeta('copaw');
    expect(meta).not.toBeNull();
    expect(meta?.description).toMatch(/升级到 QwenPaw/);
  });

  it('returns null for unknown runtimes instead of falling back to a raw string', () => {
    expect(getRuntimeMeta('not_a_runtime')).toBeNull();
    expect(getRuntimeMeta(null)).toBeNull();
    expect(getRuntimeMeta(undefined)).toBeNull();
  });
});
