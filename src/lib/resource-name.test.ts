import { describe, it, expect } from 'vitest';
import { workerNameError } from '@/lib/resource-name';

describe('workerNameError', () => {
  it('accepts names within the MinIO access-key length range', () => {
    expect(workerNameError('ce1')).toBeNull();
    expect(workerNameError('worker-alpha')).toBeNull();
    expect(workerNameError('a'.repeat(20))).toBeNull();
  });

  it('rejects names shorter than 3 characters', () => {
    expect(workerNameError('ce')).toMatch(/至少 3 个字符/);
    expect(workerNameError('a')).toMatch(/至少 3 个字符/);
  });

  it('rejects names longer than 20 characters', () => {
    expect(workerNameError('a'.repeat(21))).toMatch(/最多 20 个字符/);
  });

  it('returns null for empty input (required handled separately)', () => {
    expect(workerNameError('')).toBeNull();
    expect(workerNameError('   ')).toBeNull();
  });
});
