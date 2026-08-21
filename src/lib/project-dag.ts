// Project DAG (dependency graph) builder.
//
// Turns a project's tasks (BoardTask with dependsOn) into a minimal
// directed acyclic graph for visualization:
//
//   nodes: one per project task (id = runId, title, status, ready)
//   edges: task -> dependency (the target depends on the source)
//   externalDeps: dependency ids referenced by project tasks that are not
//     themselves project tasks (e.g. tasks from another project or
//     historical ids). They are surfaced for the UI but do not block
//     readiness of the depending task.
//
// `ready` mirrors the upstream "next" semantics at a task level: a
// non-completed task whose project-internal dependencies are all
// completed is ready to start. External dependencies are assumed
// satisfied (their state is not visible here).
//
// Layers are computed iteratively (no dependencies -> layer 0; a task's
// layer = max(dependency layers) + 1) so the renderer can lay out the
// graph top-down. Cycles are defended against by capping the pass count.

import type { BoardTask, TaskStatus } from '@/hooks/use-task-board';

export interface DagNode {
  id: string;
  title: string;
  status: TaskStatus;
  ready: boolean;
  /** 0-based dependency depth; used for vertical layout. */
  layer: number;
}

export interface DagEdge {
  /** The dependency (upstream) node id. */
  source: string;
  /** The depending (downstream) node id. */
  target: string;
}

export interface ProjectDag {
  nodes: DagNode[];
  edges: DagEdge[];
  /** Dependency ids referenced but not part of this project. */
  externalDeps: string[];
}

const TERMINAL_DONE = new Set<TaskStatus>(['completed']);

export interface DagLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
  padding?: number;
}

export interface DagLayout {
  /** Total SVG width (px). */
  width: number;
  /** Total SVG height (px). */
  height: number;
  /** Top-left position of each node, keyed by node id. */
  positions: Map<string, { x: number; y: number }>;
}

/**
 * Compute a simple top-down layout for a DAG: nodes are grouped by layer
 * (0 at the top), laid out left-to-right within a layer. The height covers
 * all layers; the width covers the widest layer.
 */
export function layoutProjectDag(
  dag: ProjectDag,
  options: DagLayoutOptions = {},
): DagLayout {
  const W = options.nodeWidth ?? 168;
  const H = options.nodeHeight ?? 40;
  const GX = options.gapX ?? 24;
  const GY = options.gapY ?? 64;
  const PAD = options.padding ?? 12;

  const byLayer = new Map<number, DagNode[]>();
  for (const n of dag.nodes) {
    const arr = byLayer.get(n.layer) ?? [];
    arr.push(n);
    byLayer.set(n.layer, arr);
  }
  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);

  const positions = new Map<string, { x: number; y: number }>();
  let width = 0;
  const height = layers.length > 0 ? layers.length * GY + H : H;
  for (const [i, layer] of layers.entries()) {
    const nodes = byLayer.get(layer) ?? [];
    let x = PAD;
    for (const n of nodes) {
      positions.set(n.id, { x, y: i * GY + 8 });
      x += W + GX;
    }
    width = Math.max(width, x - GX + PAD);
  }
  return { width, height, positions };
}

export function buildProjectDag(
  tasks: BoardTask[],
  projectId: string,
): ProjectDag {
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const byId = new Map(projectTasks.map((t) => [t.runId, t]));

  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];
  const externalDeps = new Set<string>();

  for (const task of projectTasks) {
    const deps = (task.dependsOn ?? []).filter((d) => typeof d === 'string');
    for (const dep of deps) {
      if (byId.has(dep)) {
        edges.push({ source: dep, target: task.runId });
      } else {
        externalDeps.add(dep);
      }
    }
  }

  // Iterative layering: layer(task) = max(layer(dep) + 1) over project
  // dependencies; tasks without project deps sit at layer 0. Cap passes to
  // defend against unexpected cycles in the data.
  const layerOf = new Map<string, number>();
  const maxPasses = projectTasks.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const task of projectTasks) {
      const deps = (task.dependsOn ?? []).filter((d) => byId.has(d));
      if (deps.length === 0) {
        if (layerOf.get(task.runId) !== 0) {
          layerOf.set(task.runId, 0);
          changed = true;
        }
        continue;
      }
      let maxDep = -1;
      for (const d of deps) {
        const l = layerOf.get(d);
        if (l === undefined) {
          maxDep = -1;
          break;
        }
        if (l > maxDep) maxDep = l;
      }
      if (maxDep >= 0) {
        const next = maxDep + 1;
        if (layerOf.get(task.runId) !== next) {
          layerOf.set(task.runId, next);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  for (const task of projectTasks) {
    const deps = (task.dependsOn ?? []).filter((d) => byId.has(d));
    const allDepsDone = deps.every((d) => {
      const depTask = byId.get(d);
      return depTask !== undefined && TERMINAL_DONE.has(depTask.status);
    });
    nodes.push({
      id: task.runId,
      title: task.title,
      status: task.status,
      ready: allDepsDone && !TERMINAL_DONE.has(task.status),
      layer: layerOf.get(task.runId) ?? 0,
    });
  }

  return { nodes, edges, externalDeps: Array.from(externalDeps) };
}

/** Map a normalized workflow node status (controller normalizeTaskStatus:
 * pending | delegated | in-progress | completed | revision | blocked) to the
 * task-board status space for the shared DAG color table. revision keeps its
 * own status (需修订 column); cancelled folds into blocked. */
const WORKFLOW_STATUS_MAP: Record<string, TaskStatus> = {
  pending: 'pending',
  delegated: 'assigned',
  'in-progress': 'in_progress',
  revision: 'revision',
  completed: 'completed',
  blocked: 'blocked',
  failed: 'failed',
  unknown: 'unknown',
};

/**
 * Build a ProjectDag from a workflow API response (nodes/edges/next) instead
 * of the MinIO board tasks. The controller's workflow endpoints expose
 * normalized statuses and explicit edges, so this only needs a status
 * remap — no dependsOn filtering.
 *
 * `ready` mirrors the W-PR-1 `next` array (tasks whose dependencies are all
 * completed), falling back to local derivation when `next` is not provided.
 */
export function buildWorkflowDag(
  nodes: Array<{ id: string; name?: string; status?: string }>,
  edges: Array<{ source: string; target: string }>,
  next?: string[],
): ProjectDag {
  const readySet = new Set(next ?? []);
  const completedSet = new Set(
    nodes.filter((n) => n.status === 'completed').map((n) => n.id),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const dagNodes: DagNode[] = nodes.map((n) => {
    const deps = edges.filter((e) => e.target === n.id).map((e) => e.source);
    // Readiness trusts the controller's `next` array whenever it is provided
    // (even empty — a paused/completed project has no runnable tasks). The
    // local derivation only kicks in when `next` is entirely absent.
    const allDepsDone = deps.every((d) => completedSet.has(d));
    const ready = next ? readySet.has(n.id) : allDepsDone && n.status !== 'completed';
    return {
      id: n.id,
      title: n.name || n.id,
      status: WORKFLOW_STATUS_MAP[n.status ?? ''] ?? 'unknown',
      ready,
      layer: 0,
    };
  });

  const dagEdges: DagEdge[] = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));
  const externalDeps = Array.from(
    new Set(
      edges
        .filter((e) => !byId.has(e.source) && byId.has(e.target))
        .map((e) => e.source),
    ),
  );

  // Iterative layering (same as buildProjectDag): layer = max(dep layer) + 1.
  const layerOf = new Map<string, number>();
  const maxPasses = dagNodes.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const node of dagNodes) {
      const deps = dagEdges.filter((e) => e.target === node.id).map((e) => e.source);
      if (deps.length === 0) {
        if (layerOf.get(node.id) !== 0) {
          layerOf.set(node.id, 0);
          changed = true;
        }
        continue;
      }
      let maxDep = -1;
      for (const d of deps) {
        const l = layerOf.get(d);
        if (l === undefined) {
          maxDep = -1;
          break;
        }
        if (l > maxDep) maxDep = l;
      }
      if (maxDep >= 0) {
        const nextLayer = maxDep + 1;
        if (layerOf.get(node.id) !== nextLayer) {
          layerOf.set(node.id, nextLayer);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (const node of dagNodes) {
    node.layer = layerOf.get(node.id) ?? 0;
  }

  return { nodes: dagNodes, edges: dagEdges, externalDeps };
}
