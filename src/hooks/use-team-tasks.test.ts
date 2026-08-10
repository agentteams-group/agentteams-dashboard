import { describe, it, expect } from 'vitest';
import { mergeTasks } from './use-team-tasks';
import type { TaskEntry } from '@/lib/task-store';

const baseTask = (overrides: Partial<TaskEntry> = {}): TaskEntry => ({
  runId: 'r1',
  title: 't1',
  status: 'running',
  roomId: '!room:server',
  senderMatrixUserId: '@m:server',
  subagents: [],
  steps: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('mergeTasks', () => {
  it('returns empty when both inputs are empty', () => {
    expect(mergeTasks([], [])).toEqual([]);
  });

  it('persisted wins on conflict (same runId)', () => {
    const live = baseTask({ runId: 'r1', title: 'live', status: 'running', updatedAt: 2000 });
    const persistedTask = baseTask({ runId: 'r1', title: 'persisted', status: 'completed', updatedAt: 1000 });
    const out = mergeTasks([persistedTask], [live]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('persisted');
    expect(out[0].status).toBe('completed');
  });

  it('live tasks not yet persisted are appended', () => {
    const persisted = baseTask({ runId: 'r1' });
    const liveA = baseTask({ runId: 'r2', title: 'liveA', updatedAt: 2000 });
    const liveB = baseTask({ runId: 'r3', title: 'liveB', updatedAt: 3000 });
    const out = mergeTasks([persisted], [liveA, liveB]);
    expect(out.map((t) => t.runId).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('sorts by updatedAt desc', () => {
    const a = baseTask({ runId: 'a', updatedAt: 1000 });
    const b = baseTask({ runId: 'b', updatedAt: 3000 });
    const c = baseTask({ runId: 'c', updatedAt: 2000 });
    const out = mergeTasks([a, b, c], []);
    expect(out.map((t) => t.runId)).toEqual(['b', 'c', 'a']);
  });

  it('handles duplicate runIds in persisted (later overwrites earlier)', () => {
    const older = baseTask({ runId: 'r1', title: 'older', updatedAt: 1000 });
    const newer = baseTask({ runId: 'r1', title: 'newer', updatedAt: 2000 });
    const out = mergeTasks([older, newer], []);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('newer');
  });
});
