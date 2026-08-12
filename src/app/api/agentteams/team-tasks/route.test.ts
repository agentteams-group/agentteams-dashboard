// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { __test__, type TaskBoardTask } from './route';

const {
  normalizeTask,
  normalizeProject,
  parsePlan,
  parseOutcomeFromResult,
  pickRunId,
  pickProjectId,
  normalizeStatus,
  normalizeProjectStatus,
  collectSharedTasks,
  collectSharedProjects,
  listTeamScopes,
  mergeTasks,
} = __test__;

const NOW = 1700000000000;

// ----- normalizeStatus -----

describe('normalizeStatus', () => {
  it.each([
    ['pending', 'pending'],
    ['PENDING', 'pending'],
    ['queued', 'pending'],
    ['assigned', 'assigned'],
    ['todo', 'assigned'],
    ['in_progress', 'in_progress'],
    ['in-progress', 'in_progress'],
    ['running', 'in_progress'],
    ['active', 'in_progress'],
    ['completed', 'completed'],
    ['success', 'completed'],
    ['done', 'completed'],
    ['failed', 'failed'],
    ['blocked', 'blocked'],
    ['paused', 'blocked'],
    [undefined, 'unknown'],
    ['', 'unknown'],
  ])('maps %s -> %s', (input, expected) => {
    expect(normalizeStatus(input)).toBe(expected);
  });
});

describe('normalizeProjectStatus', () => {
  it.each([
    ['planning', 'planning'],
    ['active', 'active'],
    ['running', 'active'],
    ['paused', 'paused'],
    ['completed', 'completed'],
    ['draft', 'planning'],
    [undefined, 'unknown'],
  ])('maps %s -> %s', (input, expected) => {
    expect(normalizeProjectStatus(input)).toBe(expected);
  });
});

// ----- pickRunId / pickProjectId -----

describe('pickRunId', () => {
  it('prefers task_id', () => {
    expect(pickRunId({ task_id: 'a', runId: 'b' })).toBe('a');
  });
  it('falls back through taskId -> runId -> run_id -> id', () => {
    expect(pickRunId({ taskId: 'a' })).toBe('a');
    expect(pickRunId({ runId: 'b' })).toBe('b');
    expect(pickRunId({ run_id: 'c' })).toBe('c');
    expect(pickRunId({ id: 'd' })).toBe('d');
  });
  it('returns null when no id is present', () => {
    expect(pickRunId({ title: 'x' })).toBeNull();
  });
});

describe('pickProjectId', () => {
  it('prefers project_id', () => {
    expect(pickProjectId({ project_id: 'a', runId: 'b' })).toBe('a');
  });
  it('falls back through projectId -> runId -> run_id -> id', () => {
    expect(pickProjectId({ projectId: 'a' })).toBe('a');
    expect(pickProjectId({ runId: 'b' })).toBe('b');
    expect(pickProjectId({ run_id: 'c' })).toBe('c');
    expect(pickProjectId({ id: 'd' })).toBe('d');
  });
  it('returns null when no id is present', () => {
    expect(pickProjectId({})).toBeNull();
  });
});

// ----- normalizeTask -----

describe('normalizeTask', () => {
  it('returns null for non-object input', () => {
    expect(normalizeTask(null as never, 'src', NOW, null)).toBeNull();
    expect(normalizeTask('string' as never, 'src', NOW, null)).toBeNull();
  });
  it('returns null when no runId is present', () => {
    expect(normalizeTask({ title: 'no id' }, 'src', NOW, null)).toBeNull();
  });
  it('uses task_id as canonical id', () => {
    expect(normalizeTask({ task_id: 'task-20260810-100000' }, 'src', NOW, null)?.runId).toBe(
      'task-20260810-100000',
    );
  });
  it('preserves source verbatim', () => {
    expect(normalizeTask({ task_id: 'r1' }, 'shared/tasks/abc', NOW, null)?.source).toBe(
      'shared/tasks/abc',
    );
  });
  it('parses assigned_at as createdAt', () => {
    const out = normalizeTask(
      { task_id: 'r1', assigned_at: '2026-01-01T00:00:00.000Z' },
      'src',
      NOW,
      null,
    );
    expect(out?.createdAt).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });
  it('falls back to created_at when assigned_at missing', () => {
    const out = normalizeTask(
      { task_id: 'r1', created_at: '2026-01-01T00:00:00.000Z' },
      'src',
      NOW,
      null,
    );
    expect(out?.createdAt).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });
  it('sets completedAt only when status is completed', () => {
    const inProgress = normalizeTask(
      { task_id: 'r1', status: 'in_progress', completed_at: '2026-02-01T00:00:00.000Z' },
      'src',
      NOW,
      null,
    );
    expect(inProgress?.completedAt).toBeUndefined();

    const done = normalizeTask(
      { task_id: 'r1', status: 'completed', completed_at: '2026-02-01T00:00:00.000Z' },
      'src',
      NOW,
      null,
    );
    expect(done?.completedAt).toBe(Date.parse('2026-02-01T00:00:00.000Z'));
  });
  it('title precedence: task_title > title > name', () => {
    const a = normalizeTask(
      { task_id: 'r1', task_title: 'a', title: 'b', name: 'c' },
      'src',
      NOW,
      null,
    );
    expect(a?.title).toBe('a');
    const b = normalizeTask({ task_id: 'r1', title: 'b', name: 'c' }, 'src', NOW, null);
    expect(b?.title).toBe('b');
    const c = normalizeTask({ task_id: 'r1', name: 'c' }, 'src', NOW, null);
    expect(c?.title).toBe('c');
    const d = normalizeTask({ task_id: 'r1' }, 'src', NOW, null);
    expect(d?.title).toBe('未命名任务');
  });
  it('dependsOn accepts both depends_on and dependsOn', () => {
    const a = normalizeTask(
      { task_id: 'r1', depends_on: ['a', 'b'] },
      'src',
      NOW,
      null,
    );
    expect(a?.dependsOn).toEqual(['a', 'b']);
    const b = normalizeTask(
      { task_id: 'r1', dependsOn: ['a'] },
      'src',
      NOW,
      null,
    );
    expect(b?.dependsOn).toEqual(['a']);
    const c = normalizeTask({ task_id: 'r1' }, 'src', NOW, null);
    expect(c?.dependsOn).toEqual([]);
  });
  it('filters non-string dependsOn entries', () => {
    const out = normalizeTask(
      { task_id: 'r1', depends_on: ['a', 42, null, 'b'] as never },
      'src',
      NOW,
      null,
    );
    expect(out?.dependsOn).toEqual(['a', 'b']);
  });
});

// ----- normalizeProject -----

describe('normalizeProject', () => {
  it('returns null when no project id', () => {
    expect(normalizeProject({}, 'src', NOW, [])).toBeNull();
  });
  it('uses project_name over name over title', () => {
    const out = normalizeProject(
      {
        project_id: 'p1',
        project_name: 'Project A',
        name: 'B',
        title: 'C',
      },
      'src',
      NOW,
      [],
    );
    expect(out?.name).toBe('Project A');
  });
  it('falls back to project id as name', () => {
    const out = normalizeProject({ project_id: 'p1' }, 'src', NOW, []);
    expect(out?.name).toBe('p1');
  });
  it('accepts both leader and leaderName', () => {
    expect(
      normalizeProject({ project_id: 'p1', leader: 'a' }, 'src', NOW, [])?.leader,
    ).toBe('a');
    expect(
      normalizeProject({ project_id: 'p1', leaderName: 'b' }, 'src', NOW, [])?.leader,
    ).toBe('b');
  });
  it('accepts both workers and members', () => {
    const a = normalizeProject(
      { project_id: 'p1', workers: ['w1', 'w2'] },
      'src',
      NOW,
      [],
    );
    expect(a?.workers).toEqual(['w1', 'w2']);
    const b = normalizeProject(
      { project_id: 'p1', members: ['w1'] },
      'src',
      NOW,
      [],
    );
    expect(b?.workers).toEqual(['w1']);
    const c = normalizeProject({ project_id: 'p1' }, 'src', NOW, []);
    expect(c?.workers).toEqual([]);
  });
});

// ----- parsePlan -----

describe('parsePlan', () => {
  it('returns [] for null input', () => {
    expect(parsePlan(null)).toEqual([]);
  });
  it('extracts phase headings', () => {
    const plan = `\
## Phase 1: Discovery
- [ ] task-20260810-100000 do discovery (owner: alice)
- [~] task-20260810-110000 in progress

## Phase 2: Build
- [x] task-20260811-090000 ship
`;
    const phases = parsePlan(plan);
    expect(phases).toHaveLength(2);
    expect(phases[0].heading).toBe('Phase 1: Discovery');
    expect(phases[0].items).toHaveLength(2);
    expect(phases[1].heading).toBe('Phase 2: Build');
    expect(phases[1].items).toHaveLength(1);
  });
  it('ignores non-phase headings', () => {
    const plan = `\
# Project Overview
some prose

## Phase 1: First
- [ ] task-20260810-100000 thing

## Notes
- [ ] this should be ignored
`;
    const phases = parsePlan(plan);
    expect(phases).toHaveLength(1);
    expect(phases[0].heading).toBe('Phase 1: First');
    expect(phases[0].items).toHaveLength(1);
  });
  it('marks done / in-progress / blocked correctly', () => {
    const plan = `\
## Phase 1
- [x] task-20260810-100000 done
- [~] task-20260810-110000 working
- [!] task-20260810-120000 blocked
- [ ] task-20260810-130000 pending
`;
    const items = parsePlan(plan)[0].items;
    expect(items[0].done).toBe(true);
    expect(items[1].inProgress).toBe(true);
    expect(items[2].blocked).toBe(true);
    expect(items[3].done).toBe(false);
    expect(items[3].inProgress).toBe(false);
    expect(items[3].blocked).toBe(false);
  });
  it('extracts taskId and owner from the line', () => {
    const plan = `\
## Phase 1
- [ ] task-20260810-100000 build it (owner: alice)
`;
    const item = parsePlan(plan)[0].items[0];
    expect(item.taskId).toBe('task-20260810-100000');
    expect(item.owner).toBe('alice');
  });
  it('returns empty items for a phase with no task lines', () => {
    const phases = parsePlan('## Phase 1: Empty\n\nno tasks here\n');
    expect(phases).toHaveLength(1);
    expect(phases[0].items).toEqual([]);
  });
});

// ----- parseOutcomeFromResult -----

describe('parseOutcomeFromResult', () => {
  it('returns null for null input', () => {
    expect(parseOutcomeFromResult(null)).toBeNull();
  });
  it('returns null when no Outcome heading', () => {
    expect(parseOutcomeFromResult('# Summary\nAll good.\n')).toBeNull();
  });
  it.each([
    ['## Outcome: SUCCESS', 'SUCCESS'],
    ['## Outcome SUCCESS', 'SUCCESS'],
    ['## Outcome：SUCCESS', 'SUCCESS'],
    ['## Outcome: REVISION_NEEDED', 'REVISION_NEEDED'],
    ['## Outcome: BLOCKED', 'BLOCKED'],
    ['## outcome: success', 'SUCCESS'], // case-insensitive on the word
  ])('parses %s -> %s', (input, expected) => {
    expect(parseOutcomeFromResult(input)).toBe(expected);
  });
});

// ----- mergeTasks -----

function task(id: string, overrides: Partial<TaskBoardTask> = {}): TaskBoardTask {
  return {
    runId: id,
    title: id,
    status: 'in_progress',
    assignedTo: 'alice',
    roomId: '!room',
    dependsOn: [],
    createdAt: NOW,
    outcome: null,
    source: 'shared/tasks/x',
    ...overrides,
  };
}

describe('mergeTasks', () => {
  it('keeps shared (canonical) task over worker history on runId conflict', () => {
    const shared = task('t1', { projectId: 'proj-1', outcome: 'SUCCESS' });
    const history = task('t1', { title: 'stale history', projectId: undefined });
    const merged = mergeTasks([shared], [history]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(shared);
  });

  it('dedupes and combines disjoint tasks', () => {
    const shared = [task('t1'), task('t2')];
    const history = [task('t3')];
    const merged = mergeTasks(shared, history);
    expect(merged.map((t) => t.runId).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('returns empty when both inputs are empty', () => {
    expect(mergeTasks([], [])).toEqual([]);
  });
});

// ----- Dual-track scanning helpers -----

/** Minimal fake MinIO client backed by a key -> content map. */
function makeClient(metaByKey: Record<string, unknown>): never {
  return {
    statObject: async () => ({ size: 4096 }),
    getObject: async (_bucket: string, key: string) => {
      const text = metaByKey[key];
      const stream = new Readable();
      if (text !== undefined) {
        stream.push(typeof text === 'string' ? text : JSON.stringify(text));
      }
      stream.push(null);
      return stream;
    },
  } as never;
}

/** listAt stub driven by a prefix -> ListResult map. */
function makeListAt(
  prefixMap: Record<string, { prefixes?: string[]; files?: string[] }>,
) {
  return async (_client: unknown, _bucket: string, prefix: string) => {
    const entry = prefixMap[prefix] ?? { prefixes: [], files: [] };
    return { prefixes: entry.prefixes ?? [], files: entry.files ?? [] };
  };
}

// ----- listTeamScopes -----

describe('listTeamScopes', () => {
  it('enumerates team directories under teams/', async () => {
    const listAt = makeListAt({
      'teams/': { prefixes: ['teams/sysdev/', 'teams/biz/'] },
    });
    const scopes = await listTeamScopes({} as never, 'bucket', listAt);
    expect(scopes).toEqual(['teams/sysdev/', 'teams/biz/']);
  });

  it('returns [] when the teams/ listing fails', async () => {
    const listAt = async () => {
      throw new Error('no such prefix');
    };
    const scopes = await listTeamScopes({} as never, 'bucket', listAt);
    expect(scopes).toEqual([]);
  });

  it('returns [] when teams/ has no entries', async () => {
    const listAt = makeListAt({ 'teams/': { prefixes: [] } });
    const scopes = await listTeamScopes({} as never, 'bucket', listAt);
    expect(scopes).toEqual([]);
  });
});

// ----- collectSharedTasks (dual-track) -----

describe('collectSharedTasks (dual-track)', () => {
  it('collects root and team-scoped tasks together', async () => {
    const metaByKey = {
      'shared/tasks/root-task/meta.json': {
        task_id: 'task-root',
        task_title: 'Root task',
        status: 'in_progress',
      },
      'teams/sysdev/shared/tasks/team-task/meta.json': {
        task_id: 'task-team',
        task_title: 'Team task',
        status: 'assigned',
      },
    };
    const client = makeClient(metaByKey);
    const listAt = makeListAt({
      'shared/tasks/': { prefixes: ['shared/tasks/root-task/'] },
      'teams/': { prefixes: ['teams/sysdev/'] },
      'teams/sysdev/shared/tasks/': {
        prefixes: ['teams/sysdev/shared/tasks/team-task/'],
      },
    });
    const out = await collectSharedTasks(client, 'bucket', NOW, listAt);
    expect(out.tasks).toHaveLength(2);
    const ids = out.tasks.map((t) => t.runId).sort();
    expect(ids).toEqual(['task-root', 'task-team']);
    const teamTask = out.tasks.find((t) => t.runId === 'task-team');
    expect(teamTask?.source).toBe('teams/sysdev/shared/tasks/team-task');
    expect(out.scannedKeys).toContain(
      'teams/sysdev/shared/tasks/team-task/meta.json',
    );
    expect(out.scannedKeys).toContain('shared/tasks/root-task/meta.json');
  });

  it('degrades to root only when teams/ has no entries', async () => {
    const metaByKey = {
      'shared/tasks/root-task/meta.json': {
        task_id: 'task-root',
        task_title: 'Root task',
      },
    };
    const client = makeClient(metaByKey);
    const listAt = makeListAt({
      'shared/tasks/': { prefixes: ['shared/tasks/root-task/'] },
      'teams/': { prefixes: [] },
    });
    const out = await collectSharedTasks(client, 'bucket', NOW, listAt);
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].runId).toBe('task-root');
  });

  it('returns empty when no tasks exist in either track', async () => {
    const client = makeClient({});
    const listAt = makeListAt({
      'shared/tasks/': { prefixes: [] },
      'teams/': { prefixes: [] },
    });
    const out = await collectSharedTasks(client, 'bucket', NOW, listAt);
    expect(out.tasks).toEqual([]);
    expect(out.scannedKeys).toEqual([]);
  });
});

// ----- collectSharedProjects (dual-track) -----

describe('collectSharedProjects (dual-track)', () => {
  it('collects root and team-scoped projects together', async () => {
    const metaByKey = {
      'shared/projects/root-proj/meta.json': {
        project_id: 'proj-root',
        project_name: 'Root Proj',
      },
      'teams/sysdev/shared/projects/team-proj/meta.json': {
        project_id: 'proj-team',
        project_name: 'Team Proj',
      },
    };
    const client = makeClient(metaByKey);
    const listAt = makeListAt({
      'shared/projects/': { prefixes: ['shared/projects/root-proj/'] },
      'teams/': { prefixes: ['teams/sysdev/'] },
      'teams/sysdev/shared/projects/': {
        prefixes: ['teams/sysdev/shared/projects/team-proj/'],
      },
    });
    const out = await collectSharedProjects(client, 'bucket', NOW, listAt);
    expect(out.projects).toHaveLength(2);
    const ids = out.projects.map((p) => p.runId).sort();
    expect(ids).toEqual(['proj-root', 'proj-team']);
    const teamProj = out.projects.find((p) => p.runId === 'proj-team');
    expect(teamProj?.source).toBe('teams/sysdev/shared/projects/team-proj');
  });

  it('degrades to root only when teams/ has no entries', async () => {
    const metaByKey = {
      'shared/projects/root-proj/meta.json': {
        project_id: 'proj-root',
        project_name: 'Root Proj',
      },
    };
    const client = makeClient(metaByKey);
    const listAt = makeListAt({
      'shared/projects/': { prefixes: ['shared/projects/root-proj/'] },
      'teams/': { prefixes: [] },
    });
    const out = await collectSharedProjects(client, 'bucket', NOW, listAt);
    expect(out.projects).toHaveLength(1);
    expect(out.projects[0].runId).toBe('proj-root');
  });
});
