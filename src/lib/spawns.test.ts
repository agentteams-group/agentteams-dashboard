// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api-error';
import type { SpawnNode } from './agentteams-projects-api';
import {
  SPAWN_MESSAGE_FOLD_LINES,
  buildSpawnForest,
  classifySpawnError,
  countSpawnNodes,
  flattenSpawnTree,
  foldMessageContent,
  spawnDescendantCount,
  spawnHasMoreCount,
  spawnRowName,
} from './spawns';

function node(overrides: Partial<SpawnNode> = {}): SpawnNode {
  return {
    session_id: overrides.session_id ?? 's1',
    status: 'idle',
    ...overrides,
  };
}

describe('buildSpawnForest', () => {
  it('links children by root_session_id and keeps other nodes as roots', () => {
    const forest = buildSpawnForest([
      node({ session_id: 'root' }),
      node({ session_id: 'child-a', root_session_id: 'root' }),
      node({ session_id: 'child-b', root_session_id: 'child-a' }),
      node({ session_id: 'orphan', root_session_id: null }),
      // parent outside the list (legacy worker / another team) → root
      node({ session_id: 'foreign', root_session_id: 'matrix:!room' }),
    ]);

    expect(forest.map((n) => n.session_id)).toEqual(['root', 'orphan', 'foreign']);
    expect(forest[0].children?.map((n) => n.session_id)).toEqual(['child-a']);
    expect(forest[0].children?.[0].children?.map((n) => n.session_id)).toEqual(['child-b']);
  });

  it('does not mutate the input nodes', () => {
    const input = [node({ session_id: 'root' }), node({ session_id: 'kid', root_session_id: 'root' })];
    buildSpawnForest(input);
    expect(input[0].children).toBeUndefined();
    expect(input[1].children).toBeUndefined();
  });

  it('breaks parent cycles instead of swallowing the nodes', () => {
    const forest = buildSpawnForest([
      node({ session_id: 'a', root_session_id: 'b' }),
      node({ session_id: 'b', root_session_id: 'a' }),
    ]);
    expect(countSpawnNodes(forest)).toBe(2);
    expect(forest).toHaveLength(1);
    expect(forest[0].children).toHaveLength(1);
  });

  it('drops duplicates and entries without a session id', () => {
    const forest = buildSpawnForest([
      node({ session_id: 's1', name: 'first' }),
      node({ session_id: 's1', name: 'second' }),
      { session_id: '', status: 'idle' },
      node({ session_id: 's2', root_session_id: 's1' }),
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0].name).toBe('first');
    expect(forest[0].children).toHaveLength(1);
  });

  it('returns [] for missing input', () => {
    expect(buildSpawnForest(undefined)).toEqual([]);
  });
});

describe('flattenSpawnTree', () => {
  const tree: SpawnNode[] = [
    node({
      session_id: 'root',
      children: [
        node({ session_id: 'a', children: [node({ session_id: 'a1' })] }),
        node({ session_id: 'b' }),
      ],
    }),
  ];

  it('flattens depth-first with depth and hasChildren', () => {
    const rows = flattenSpawnTree(tree);
    expect(rows.map((r) => [r.node.session_id, r.depth, r.hasChildren])).toEqual([
      ['root', 0, true],
      ['a', 1, true],
      ['a1', 2, false],
      ['b', 1, false],
    ]);
  });

  it('keeps a collapsed node but hides its subtree', () => {
    const rows = flattenSpawnTree(tree, new Set(['a']));
    expect(rows.map((r) => r.node.session_id)).toEqual(['root', 'a', 'b']);
    expect(rows[1].hasChildren).toBe(true);
  });

  it('stops on cyclic children instead of recursing forever', () => {
    const cyclic = node({ session_id: 'loop' });
    cyclic.children = [cyclic];
    const rows = flattenSpawnTree([cyclic]);
    expect(rows.map((r) => r.node.session_id)).toEqual(['loop']);
  });
});

describe('countSpawnNodes / spawnDescendantCount', () => {
  it('counts every level and tolerates malformed lists', () => {
    const tree: SpawnNode[] = [
      node({ session_id: 'root', children: [node({ session_id: 'a', children: [node({ session_id: 'a1' })] })] }),
    ];
    expect(countSpawnNodes(tree)).toBe(3);
    expect(spawnDescendantCount(tree[0])).toBe(2);
    expect(spawnDescendantCount(node())).toBe(0);
    expect(countSpawnNodes(undefined)).toBe(0);
  });
});

describe('spawnRowName / spawnHasMoreCount', () => {
  it('prefers the name and falls back to the session id', () => {
    expect(spawnRowName(node({ session_id: 's1', name: '实现登录' }))).toBe('实现登录');
    expect(spawnRowName(node({ session_id: 's1' }))).toBe('s1');
  });

  it('reports shown count only when has_more is true and rows exist', () => {
    expect(spawnHasMoreCount(true, 50)).toBe(50);
    expect(spawnHasMoreCount(false, 50)).toBe(0);
    expect(spawnHasMoreCount(true, 0)).toBe(0);
  });
});

describe('foldMessageContent', () => {
  it('leaves short content untouched', () => {
    expect(foldMessageContent('a\nb')).toEqual({ text: 'a\nb', folded: false });
    expect(foldMessageContent('')).toEqual({ text: '', folded: false });
  });

  it('folds content beyond the line limit and normalizes CRLF', () => {
    const lines = Array.from({ length: SPAWN_MESSAGE_FOLD_LINES + 2 }, (_, i) => `line-${i + 1}`);
    const result = foldMessageContent(lines.join('\r\n'));
    expect(result.folded).toBe(true);
    expect(result.text.split('\n')).toHaveLength(SPAWN_MESSAGE_FOLD_LINES);
    expect(result.text).not.toContain('\r');
    expect(result.text.startsWith('line-1\nline-2')).toBe(true);
  });
});

describe('classifySpawnError', () => {
  it('maps 404/405 to unsupported (hide the block)', () => {
    expect(classifySpawnError(new ApiError('missing', 404, '/spawns'))).toBe('unsupported');
    expect(classifySpawnError(new ApiError('no method', 405, '/spawns'))).toBe('unsupported');
  });

  it('maps 403 to forbidden', () => {
    expect(classifySpawnError(new ApiError('denied', 403, '/spawns'))).toBe('forbidden');
  });

  it('keeps everything else retryable', () => {
    expect(classifySpawnError(new ApiError('boom', 500, '/spawns'))).toBe('error');
    expect(classifySpawnError(new NetworkError('/spawns'))).toBe('error');
    expect(classifySpawnError(new Error('nope'))).toBe('error');
  });
});
