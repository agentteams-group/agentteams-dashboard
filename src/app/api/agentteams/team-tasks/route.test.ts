import { describe, it, expect } from 'vitest';
import { __test__ } from './route';

const { normalizeTask, unwrapFileContent } = __test__;

describe('normalizeTask', () => {
  const now = 1700000000000;

  it('returns null for non-object input', () => {
    expect(normalizeTask(null as never, now, 'src')).toBeNull();
    expect(normalizeTask('string' as never, now, 'src')).toBeNull();
    expect(normalizeTask(42 as never, now, 'src')).toBeNull();
  });

  it('returns null when no runId is present', () => {
    expect(normalizeTask({ title: 'no id' }, now, 'src')).toBeNull();
  });

  it('accepts run_id and id as runId fallbacks', () => {
    expect(normalizeTask({ run_id: 'x' }, now, 'src')?.runId).toBe('x');
    expect(normalizeTask({ id: 'y' }, now, 'src')?.runId).toBe('y');
    expect(normalizeTask({ taskId: 'z' }, now, 'src')?.runId).toBe('z');
  });

  it('preserves the source field on the entry', () => {
    const out = normalizeTask({ runId: 'r1' }, now, 'shared/tasks/abc');
    expect(out?.source).toBe('shared/tasks/abc');
  });

  it('parses ISO createdAt/updatedAt to epoch ms', () => {
    const out = normalizeTask(
      { runId: 'r1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
      now,
      'shared/tasks/r1',
    );
    expect(out?.createdAt).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(out?.updatedAt).toBe(Date.parse('2026-01-02T00:00:00.000Z'));
  });

  it('falls back to "未命名任务" when title and name are missing', () => {
    expect(normalizeTask({ runId: 'r1' }, now, 'src')?.title).toBe('未命名任务');
    expect(normalizeTask({ runId: 'r1', name: 'real name' }, now, 'src')?.title).toBe('real name');
  });
});

describe('unwrapFileContent', () => {
  it('returns an array as-is', () => {
    const arr = [{ runId: 'a' }, { runId: 'b' }];
    expect(unwrapFileContent(arr)).toEqual(arr);
  });

  it('unwraps { tasks: [...] } envelopes', () => {
    const arr = [{ runId: 'a' }];
    expect(unwrapFileContent({ tasks: arr })).toEqual(arr);
  });

  it('wraps a single task object into a one-element array', () => {
    const obj = { runId: 'a' };
    expect(unwrapFileContent(obj)).toEqual([obj]);
  });

  it('returns [] for unrelated JSON shapes', () => {
    expect(unwrapFileContent({ unrelated: true })).toEqual([]);
    expect(unwrapFileContent(null)).toEqual([]);
    expect(unwrapFileContent(123)).toEqual([]);
  });
});
