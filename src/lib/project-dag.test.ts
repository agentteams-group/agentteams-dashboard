// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildProjectDag, layoutProjectDag, type ProjectDag } from './project-dag';
import type { BoardTask } from '@/hooks/use-task-board';

function task(
  id: string,
  overrides: Partial<BoardTask> = {},
): BoardTask {
  return {
    runId: id,
    title: id,
    status: 'assigned',
    assignedTo: 'alice',
    roomId: '!room',
    dependsOn: [],
    createdAt: 0,
    outcome: null,
    source: 'shared/tasks/x',
    projectId: 'proj-1',
    ...overrides,
  };
}

describe('buildProjectDag', () => {
  it('builds nodes + edges for a linear chain', () => {
    const tasks = [
      task('t1'),
      task('t2', { dependsOn: ['t1'] }),
      task('t3', { dependsOn: ['t2'] }),
    ];
    const dag = buildProjectDag(tasks, 'proj-1');
    expect(dag.nodes.map((n) => n.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(dag.edges).toEqual([
      { source: 't1', target: 't2' },
      { source: 't2', target: 't3' },
    ]);
    expect(dag.externalDeps).toEqual([]);
  });

  it('computes layers top-down (no deps -> 0, then +1 per hop)', () => {
    const tasks = [
      task('t1'),
      task('t2', { dependsOn: ['t1'] }),
      task('t3', { dependsOn: ['t1', 't2'] }),
      task('t4', { dependsOn: ['t3'] }),
    ];
    const dag = buildProjectDag(tasks, 'proj-1');
    const layer = Object.fromEntries(dag.nodes.map((n) => [n.id, n.layer]));
    expect(layer).toEqual({ t1: 0, t2: 1, t3: 2, t4: 3 });
  });

  it('marks a task ready when all project deps are completed', () => {
    const tasks = [
      task('t1', { status: 'completed' }),
      task('t2', { dependsOn: ['t1'] }),
    ];
    const dag = buildProjectDag(tasks, 'proj-1');
    const t2 = dag.nodes.find((n) => n.id === 't2');
    expect(t2?.ready).toBe(true);
    const t1 = dag.nodes.find((n) => n.id === 't1');
    expect(t1?.ready).toBe(false); // already completed, not "ready to start"
  });

  it('does not mark ready when a dependency is not completed', () => {
    const tasks = [
      task('t1', { status: 'in_progress' }),
      task('t2', { dependsOn: ['t1'] }),
    ];
    const dag = buildProjectDag(tasks, 'proj-1');
    expect(dag.nodes.find((n) => n.id === 't2')?.ready).toBe(false);
  });

  it('surfaces external deps without blocking readiness', () => {
    const tasks = [
      task('t1', { dependsOn: ['external-task-99'] }),
      task('t2', { dependsOn: ['t1'] }),
    ];
    const dag = buildProjectDag(tasks, 'proj-1');
    expect(dag.externalDeps).toEqual(['external-task-99']);
    // t1's only dependency is external -> assumed satisfied -> ready.
    expect(dag.nodes.find((n) => n.id === 't1')?.ready).toBe(true);
    // t2 depends on t1 (not completed) -> not ready.
    expect(dag.nodes.find((n) => n.id === 't2')?.ready).toBe(false);
    // External dep is not an edge (no node to draw).
    expect(dag.edges).toEqual([{ source: 't1', target: 't2' }]);
  });

  it('ignores tasks from other projects', () => {
    const tasks = [
      task('t1'),
      task('other', { projectId: 'proj-2' }),
    ];
    const dag = buildProjectDag(tasks, 'proj-1');
    expect(dag.nodes.map((n) => n.id)).toEqual(['t1']);
  });

  it('returns empty dag for a project with no tasks', () => {
    const dag = buildProjectDag([], 'proj-1');
    expect(dag.nodes).toEqual([]);
    expect(dag.edges).toEqual([]);
    expect(dag.externalDeps).toEqual([]);
  });

  it('defends against a cycle without infinite loop', () => {
    const tasks = [
      task('t1', { dependsOn: ['t2'] }),
      task('t2', { dependsOn: ['t1'] }),
    ];
    const dag = buildProjectDag(tasks, 'proj-1');
    // Both nodes still present; layering may be partial but must terminate.
    expect(dag.nodes).toHaveLength(2);
    expect(dag.edges).toHaveLength(2);
  });
});

// ----- layoutProjectDag -----

describe('layoutProjectDag', () => {
  function makeDag(): ProjectDag {
    return {
      nodes: [
        { id: 't1', title: 'a', status: 'completed', ready: false, layer: 0 },
        { id: 't2', title: 'b', status: 'assigned', ready: true, layer: 1 },
      ],
      edges: [{ source: 't1', target: 't2' }],
      externalDeps: [],
    };
  }

  it('places layer-0 nodes above layer-1 nodes', () => {
    const layout = layoutProjectDag(makeDag(), {
      nodeWidth: 100,
      nodeHeight: 30,
      gapY: 50,
      padding: 10,
    });
    const t1 = layout.positions.get('t1');
    const t2 = layout.positions.get('t2');
    expect(t1?.y).toBe(8);
    expect(t2?.y).toBe(58); // 8 + 50
    expect(t2 && t1 ? t2.y > t1.y : false).toBe(true);
  });

  it('lays nodes in the same layer left-to-right', () => {
    const dag: ProjectDag = {
      nodes: [
        { id: 't1', title: 'a', status: 'pending', ready: false, layer: 0 },
        { id: 't2', title: 'b', status: 'pending', ready: false, layer: 0 },
      ],
      edges: [],
      externalDeps: [],
    };
    const layout = layoutProjectDag(dag, { nodeWidth: 100, gapX: 20, padding: 10 });
    const t1 = layout.positions.get('t1');
    const t2 = layout.positions.get('t2');
    expect(t1?.x).toBe(10);
    expect(t2?.x).toBe(130); // 10 + 100 + 20
    expect(layout.width).toBe(240); // 130 + 100 + 10
    expect(layout.height).toBe(104); // 1 layer * default gapY(64) + default nodeHeight(40)
  });

  it('returns empty layout for an empty dag', () => {
    const layout = layoutProjectDag({ nodes: [], edges: [], externalDeps: [] });
    expect(layout.positions.size).toBe(0);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(40); // default nodeHeight fallback
  });
});
