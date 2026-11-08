import { describe, it, expect } from 'vitest';
import type { WorkerResponse } from '@/lib/agentteams-api';
import {
  filterWorkers,
  groupWorkersByTeam,
  paginateWorkers,
  sortWorkers,
  computeRuntimeDist,
} from '@/components/dashboard/sections/workers/worker-selectors';

const W = (over: Partial<WorkerResponse>): WorkerResponse => ({
  name: 'w',
  phase: 'Running',
  state: 'Running',
  containerManaged: true,
  model: 'm',
  runtime: 'openclaw',
  image: 'i',
  containerState: 's',
  matrixUserID: 'u',
  roomID: 'r',
  message: '',
  team: '',
  role: '',
  ...over,
});

describe('filterWorkers', () => {
  it('returns all when no query', () => {
    const list = [W({ name: 'a' }), W({ name: 'b' })];
    expect(filterWorkers(list, '')).toEqual(list);
  });

  it('returns empty when input undefined', () => {
    expect(filterWorkers(undefined, 'q')).toEqual([]);
  });

  it('matches name', () => {
    const list = [W({ name: 'alice' }), W({ name: 'bob' })];
    expect(filterWorkers(list, 'ali')).toHaveLength(1);
  });

  it('matches model', () => {
    const list = [W({ name: 'a', model: 'gpt-4' }), W({ name: 'b', model: 'claude' })];
    expect(filterWorkers(list, 'gpt')).toHaveLength(1);
  });

  it('matches runtime', () => {
    const list = [W({ name: 'a', runtime: 'openclaw' }), W({ name: 'b', runtime: 'hermes' })];
    expect(filterWorkers(list, 'herm')).toHaveLength(1);
  });

  it('matches team', () => {
    const list = [W({ name: 'a', team: 'alpha' }), W({ name: 'b', team: 'beta' })];
    expect(filterWorkers(list, 'alpha')).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const list = [W({ name: 'Alice' })];
    expect(filterWorkers(list, 'ALICE')).toHaveLength(1);
  });
});

describe('sortWorkers', () => {
  it('sorts by name', () => {
    const list = [W({ name: 'b' }), W({ name: 'a' })];
    expect(sortWorkers(list, 'name').map((w) => w.name)).toEqual(['a', 'b']);
  });

  it('sorts by phase', () => {
    const list = [W({ phase: 'Running' }), W({ phase: 'Failed' })];
    expect(sortWorkers(list, 'phase').map((w) => w.phase)).toEqual(['Failed', 'Running']);
  });

  it('sorts by runtime', () => {
    const list = [W({ runtime: 'hermes' }), W({ runtime: 'copaw' })];
    expect(sortWorkers(list, 'runtime').map((w) => w.runtime)).toEqual(['copaw', 'hermes']);
  });

  it('sorts by team (handles missing)', () => {
    const list = [W({ team: '' }), W({ team: 'a' })];
    expect(sortWorkers(list, 'team').map((w) => w.team)).toEqual(['', 'a']);
  });
});

describe('paginateWorkers', () => {
  const list = Array.from({ length: 25 }, (_, i) => W({ name: `w${i}` }));

  it('clamps page to valid range', () => {
    const { totalPages, safePage } = paginateWorkers(list, 100, 10);
    expect(totalPages).toBe(3);
    expect(safePage).toBe(3);
  });

  it('returns the correct slice', () => {
    const { items } = paginateWorkers(list, 2, 10);
    expect(items).toHaveLength(10);
    expect(items[0].name).toBe('w10');
    expect(items[9].name).toBe('w19');
  });

  it('handles empty list', () => {
    const { totalPages, safePage, items } = paginateWorkers([], 1, 10);
    expect(totalPages).toBe(1);
    expect(safePage).toBe(1);
    expect(items).toEqual([]);
  });
});

describe('groupWorkersByTeam', () => {
  it('groups by team and puts ungrouped last', () => {
    const groups = groupWorkersByTeam([
      W({ name: 'a', team: 'beta' }),
      W({ name: 'b', team: '' }),
      W({ name: 'c', team: 'alpha' }),
      W({ name: 'd', team: 'beta' }),
    ]);
    expect(groups.map((g) => g.team)).toEqual(['alpha', 'beta', '']);
    expect(groups[1].workers.map((w) => w.name)).toEqual(['a', 'd']);
    expect(groups[2].workers.map((w) => w.name)).toEqual(['b']);
  });

  it('treats whitespace-only team as ungrouped', () => {
    const groups = groupWorkersByTeam([W({ name: 'a', team: '   ' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].team).toBe('');
  });

  it('drops empty groups after filtering', () => {
    const filtered = groupWorkersByTeam(filterWorkers([W({ name: 'a', team: 'alpha' })], 'zzz'));
    expect(filtered).toEqual([]);
  });
});

describe('computeRuntimeDist', () => {
  it('counts each runtime', () => {
    const list = [
      W({ runtime: 'openclaw' }),
      W({ runtime: 'openclaw' }),
      W({ runtime: 'hermes' }),
    ];
    expect(computeRuntimeDist(list)).toEqual({ openclaw: 2, hermes: 1 });
  });

  it('handles empty input', () => {
    expect(computeRuntimeDist(undefined)).toEqual({});
  });
});
