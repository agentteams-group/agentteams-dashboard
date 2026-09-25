import { describe, expect, it } from 'vitest';
import {
  CREATABLE_MANAGER_RUNTIMES,
  CREATABLE_WORKER_RUNTIMES,
  isLegacyCopaw,
  isLegacyRuntime,
  rejectCopawCreate,
} from './runtime-options';

describe('runtime options', () => {
  it('does not offer copaw when creating a worker', () => {
    expect(CREATABLE_WORKER_RUNTIMES.map((item) => item.value)).toEqual([
      'openclaw',
      'hermes',
      'qwenpaw',
      'deepseek-harness',
    ]);
  });

  it('does not offer copaw when creating a manager', () => {
    expect(CREATABLE_MANAGER_RUNTIMES.map((item) => item.value)).toEqual(['openclaw', 'qwenpaw']);
  });

  it('recognises leftover copaw instances as legacy', () => {
    expect(isLegacyCopaw('copaw')).toBe(true);
    expect(isLegacyCopaw('qwenpaw')).toBe(false);
    expect(isLegacyRuntime('openhuman')).toBe(true);
    expect(isLegacyRuntime('openclaw')).toBe(false);
  });

  it('rejects copaw on create/apply paths', () => {
    expect(rejectCopawCreate('copaw')).toMatch(/停止新建/);
    expect(rejectCopawCreate('qwenpaw')).toBeNull();
  });
});
