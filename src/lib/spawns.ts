// spawns.ts — pure derivation for the project "子会话" tree and its lazy
// message stream (no React / no fetch, node-env testable).
//
// The controller already groups spawns per worker and returns a flat list with
// `root_session_id` pointing at the parent session (QwenPaw 2.1+). Everything
// the panel needs to *derive* from that payload lives here: forest building,
// flattening for rendering, counts, has_more wording, error classification and
// the 6-line message fold.

import { ApiError, isUnsupportedEndpointError } from './api-error';
import type { SpawnNode } from './agentteams-projects-api';

/** One rendered tree row (indent by `depth`, caret by `hasChildren`). */
export interface SpawnRowModel {
  node: SpawnNode;
  depth: number;
  hasChildren: boolean;
}

/** Lines shown before a spawn message folds behind 展开/收起. */
export const SPAWN_MESSAGE_FOLD_LINES = 6;

/** Hard recursion cap: a cyclic root_session_id chain must never hang the UI. */
const MAX_TREE_DEPTH = 64;

/** Link a flat spawn list into a forest using `root_session_id`.
 *
 * - Unknown / self / cyclic parents become roots (a cycle must not swallow
 *   every node — legacy data can be inconsistent).
 * - Duplicate session ids keep the first occurrence.
 * - Input nodes are copied; the caller's objects are never mutated.
 */
export function buildSpawnForest(nodes: SpawnNode[] | undefined): SpawnNode[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const bySession = new Map<string, SpawnNode>();
  for (const node of nodes) {
    if (!node || typeof node.session_id !== 'string' || node.session_id === '') continue;
    if (bySession.has(node.session_id)) continue;
    bySession.set(node.session_id, { ...node, children: [] });
  }

  const parentOf = new Map<string, string>();
  for (const [id, node] of bySession) {
    const rootId = node.root_session_id ?? '';
    if (rootId && rootId !== id && bySession.has(rootId)) parentOf.set(id, rootId);
  }

  // Break cycles (a → b → a): drop the link of the node where the walk
  // revisits itself, promoting it to a root.
  for (const id of [...parentOf.keys()]) {
    const seen = new Set<string>([id]);
    let cursor = parentOf.get(id);
    while (cursor) {
      if (seen.has(cursor)) {
        parentOf.delete(id);
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }

  const roots: SpawnNode[] = [];
  for (const [id, node] of bySession) {
    const parentId = parentOf.get(id);
    const parent = parentId ? bySession.get(parentId) : undefined;
    if (parent) {
      parent.children = [...(parent.children ?? []), node];
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Flatten the tree into render rows. A collapsed node keeps its own row but
 * hides its subtree; `hasChildren` still reports the hidden subtree so the
 * caret keeps working. */
export function flattenSpawnTree(
  nodes: SpawnNode[] | undefined,
  collapsed: ReadonlySet<string> = new Set<string>(),
): SpawnRowModel[] {
  const out: SpawnRowModel[] = [];
  const walk = (list: SpawnNode[] | undefined, depth: number, ancestors: ReadonlySet<string>): void => {
    if (!Array.isArray(list) || depth > MAX_TREE_DEPTH) return;
    for (const node of list) {
      if (!node || typeof node.session_id !== 'string' || node.session_id === '') continue;
      if (ancestors.has(node.session_id)) continue; // defensive: cyclic children
      const children = Array.isArray(node.children) ? node.children : [];
      out.push({ node, depth, hasChildren: children.length > 0 });
      if (children.length > 0 && !collapsed.has(node.session_id)) {
        const next = new Set(ancestors);
        next.add(node.session_id);
        walk(children, depth + 1, next);
      }
    }
  };
  walk(nodes, 0, new Set<string>());
  return out;
}

/** Recursive spawn count (all levels) — card header badge. Cycle-safe. */
export function countSpawnNodes(
  nodes: SpawnNode[] | undefined,
  seen: Set<string> = new Set<string>(),
): number {
  if (!Array.isArray(nodes)) return 0;
  let total = 0;
  for (const node of nodes) {
    if (!node || typeof node.session_id !== 'string' || node.session_id === '') continue;
    if (seen.has(node.session_id)) continue;
    seen.add(node.session_id);
    total += 1 + countSpawnNodes(node.children, seen);
  }
  return total;
}

/** Descendant count of one node (direct children included); 0 = leaf. */
export function spawnDescendantCount(node: SpawnNode | undefined): number {
  return countSpawnNodes(node?.children);
}

/** Row label: name first, session id as the honest fallback. */
export function spawnRowName(node: SpawnNode): string {
  return node.name || node.session_id || '?';
}

/** Item count for the has_more hint (0 = hide the hint). */
export function spawnHasMoreCount(hasMore: boolean | undefined, shown: number): number {
  return hasMore === true && shown > 0 ? shown : 0;
}

/** Fold a message body to `maxLines`; `folded` tells the UI to offer 展开.
 * CRLF is normalized in both branches so pre-wrap renders consistently. */
export function foldMessageContent(
  content: string | null | undefined,
  maxLines: number = SPAWN_MESSAGE_FOLD_LINES,
): { text: string; folded: boolean } {
  const text = typeof content === 'string' ? content : '';
  if (!text) return { text: '', folded: false };
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return { text: lines.join('\n'), folded: false };
  return { text: lines.slice(0, maxLines).join('\n'), folded: true };
}

/**
 * Spawn endpoint failure → UI state.
 * - `unsupported` (404 / 405): the Controller predates the spawn routes (or
 *   the project has no readable worker mirror) → hide the whole block.
 * - `forbidden` (403): cross-team access → inline "无权限查看".
 * - `error`: retryable.
 */
export function classifySpawnError(err: unknown): 'unsupported' | 'forbidden' | 'error' {
  if (isUnsupportedEndpointError(err)) return 'unsupported';
  if (err instanceof ApiError && err.status === 403) return 'forbidden';
  return 'error';
}
