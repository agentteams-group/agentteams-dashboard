import { describe, expect, it } from 'vitest';
import {
  FILES_GC_MS,
  FILES_STALE_MS,
  MIN_REFETCH_GAP_MS,
  SEARCH_STALE_MS,
  TRASH_STALE_MS,
  VISIBLE_REFRESH_AFTER_MS,
  filesQueryKeys,
  mergeOptimisticRename,
  pruneSelection,
  queryKeysForWrite,
  shouldBackgroundRefresh,
} from './files-refresh';
import type { HumanFileEntry } from './human-files-api';

const FILE: HumanFileEntry = { name: 'readme.md', path: 'readme.md', type: 'file', size: 2048 };
const DIR: HumanFileEntry = { name: 'docs', path: 'docs', type: 'directory', size: 0 };
const NESTED: HumanFileEntry = { name: 'guide.md', path: 'docs/guide.md', type: 'file', size: 10 };

describe('files-refresh 缓存窗口', () => {
  it('目录/递归 30s 新鲜、5min 保活；回收站与搜索 60s', () => {
    expect(FILES_STALE_MS).toBe(30_000);
    expect(FILES_GC_MS).toBe(5 * 60_000);
    expect(TRASH_STALE_MS).toBe(60_000);
    expect(SEARCH_STALE_MS).toBe(60_000);
    // 保活必须长于新鲜期，否则「过期未重取」窗口里缓存就被回收了。
    expect(FILES_GC_MS).toBeGreaterThan(FILES_STALE_MS);
    expect(TRASH_STALE_MS).toBeGreaterThan(FILES_STALE_MS);
  });

  it('可见刷新阈值 60s；去重闸门 5s 且短于新鲜期', () => {
    expect(VISIBLE_REFRESH_AFTER_MS).toBe(60_000);
    expect(MIN_REFETCH_GAP_MS).toBe(5_000);
    expect(MIN_REFETCH_GAP_MS).toBeLessThan(FILES_STALE_MS);
  });
});

describe('shouldBackgroundRefresh', () => {
  const now = 1_700_000_000_000;

  it('从未成功加载 → 必须取', () => {
    expect(shouldBackgroundRefresh(0, now, VISIBLE_REFRESH_AFTER_MS)).toBe(true);
    expect(shouldBackgroundRefresh(null, now, VISIBLE_REFRESH_AFTER_MS)).toBe(true);
    expect(shouldBackgroundRefresh(undefined, now, VISIBLE_REFRESH_AFTER_MS)).toBe(true);
  });

  it('恰好 60s → 不取；超过 60s → 取', () => {
    expect(shouldBackgroundRefresh(now - 60_000, now, 60_000)).toBe(false);
    expect(shouldBackgroundRefresh(now - 60_001, now, 60_000)).toBe(true);
  });

  it('刚取过 5s → 去重闸门拦住', () => {
    expect(shouldBackgroundRefresh(now - 5_000, now, MIN_REFETCH_GAP_MS)).toBe(false);
    expect(shouldBackgroundRefresh(now - 5_001, now, MIN_REFETCH_GAP_MS)).toBe(true);
  });

  it('时钟回拨 / 非法时间 → 不触发（避免永久压制或乱刷）', () => {
    expect(shouldBackgroundRefresh(now + 60_000, now, 60_000)).toBe(false);
    expect(shouldBackgroundRefresh(now - 60_000, Number.NaN, 60_000)).toBe(false);
  });
});

describe('pruneSelection', () => {
  it('全部仍存在 → 原样保留且无摘除', () => {
    const r = pruneSelection(['a.md', 'docs'], ['a.md', 'docs']);
    expect([...r.selected]).toEqual(['a.md', 'docs']);
    expect(r.removed).toEqual([]);
  });

  it('消失的条目被摘掉并报告（顺序 = 原选择顺序）', () => {
    const r = pruneSelection(['docs'], new Set(['a.md', 'docs', 'gone.md']));
    expect([...r.selected]).toEqual(['docs']);
    expect(r.removed).toEqual(['a.md', 'gone.md']);
  });

  it('列表清空 → 选择清空但把原选择都报出来', () => {
    const r = pruneSelection([], ['x', 'y']);
    expect(r.selected.size).toBe(0);
    expect(r.removed).toEqual(['x', 'y']);
  });
});

describe('mergeOptimisticRename', () => {
  it('同目录改名：path 与 name 一起换', () => {
    const out = mergeOptimisticRename([FILE, DIR], 'readme.md', 'renamed.md');
    expect(out[0]).toMatchObject({ path: 'renamed.md', name: 'renamed.md' });
    expect(out[1]).toBe(DIR);
  });

  it('移动换目录：path 指向新目录，size/type 不丢', () => {
    const out = mergeOptimisticRename([FILE], 'readme.md', 'docs/readme.md');
    expect(out[0]).toMatchObject({ path: 'docs/readme.md', name: 'readme.md', size: 2048, type: 'file' });
  });

  it('目录改名：递归缓存里子项按前缀重写', () => {
    const out = mergeOptimisticRename([DIR, NESTED], 'docs', '文档');
    expect(out.map((e) => e.path)).toEqual(['文档', '文档/guide.md']);
    expect(out[1].name).toBe('guide.md');
  });

  it('老形态（只有 name、无 path）按末段命中', () => {
    const legacy: HumanFileEntry = { name: 'readme.md', type: 'file', size: 1 };
    const out = mergeOptimisticRename([legacy], 'readme.md', 'renamed.md');
    expect(out[0].name).toBe('renamed.md');
    expect(out[0].path).toBe('renamed.md');
  });

  it('没命中 / 同路径 → 返回原数组引用（调用方据此跳过写入）', () => {
    const entries = [FILE];
    expect(mergeOptimisticRename(entries, 'nope.md', 'other.md')).toBe(entries);
    expect(mergeOptimisticRename(entries, 'readme.md', 'readme.md')).toBe(entries);
  });
});

describe('queryKeysForWrite', () => {
  const keyStrings = (scope: Parameters<typeof queryKeysForWrite>[0]) =>
    queryKeysForWrite(scope).map((key) => JSON.stringify(key));

  it('重命名：当前目录 + 递归 + 配额；不碰搜索与回收站', () => {
    expect(keyStrings({ kind: 'rename', human: 'alice', dir: 'docs' })).toEqual([
      JSON.stringify(filesQueryKeys.dir('alice', 'docs')),
      JSON.stringify(filesQueryKeys.recursive('alice')),
      JSON.stringify(filesQueryKeys.quota('alice')),
    ]);
    expect(keyStrings({ kind: 'rename', human: 'alice', dir: 'docs' })).not.toContain(
      JSON.stringify(filesQueryKeys.search('alice')),
    );
  });

  it('跨目录移动：源目录与目标目录都要失效', () => {
    expect(keyStrings({ kind: 'move', human: 'alice', dir: 'docs', destDir: 'archive' })).toEqual([
      JSON.stringify(filesQueryKeys.dir('alice', 'docs')),
      JSON.stringify(filesQueryKeys.dir('alice', 'archive')),
      JSON.stringify(filesQueryKeys.recursive('alice')),
      JSON.stringify(filesQueryKeys.quota('alice')),
    ]);
  });

  it('删除：目录 + 递归 + 配额 + 回收站', () => {
    expect(keyStrings({ kind: 'delete', human: 'alice', dir: '' })).toEqual([
      JSON.stringify(filesQueryKeys.dir('alice', '')),
      JSON.stringify(filesQueryKeys.trash('alice')),
      JSON.stringify(filesQueryKeys.recursive('alice')),
      JSON.stringify(filesQueryKeys.quota('alice')),
    ]);
  });

  it('配额保存 / 回收站彻底删除：只失效自家 key', () => {
    expect(keyStrings({ kind: 'quota', human: 'alice', dir: '' })).toEqual([
      JSON.stringify(filesQueryKeys.quota('alice')),
    ]);
    expect(keyStrings({ kind: 'purge', human: 'alice', dir: '' })).toEqual([
      JSON.stringify(filesQueryKeys.trash('alice')),
      JSON.stringify(filesQueryKeys.quota('alice')),
    ]);
  });

  it('无人名 → 不失效任何 key', () => {
    expect(queryKeysForWrite({ kind: 'upload', human: '', dir: '' })).toEqual([]);
  });
});

describe('filesQueryKeys', () => {
  it('搜索 key 按词区分，且可以用前缀整体失效', () => {
    const a = filesQueryKeys.searchTerm('alice', 'report');
    const b = filesQueryKeys.searchTerm('alice', 'docs');
    expect(a).not.toEqual(b);
    expect(a.slice(0, filesQueryKeys.search('alice').length)).toEqual([
      ...filesQueryKeys.search('alice'),
    ]);
  });

  it('目录 key 带上目录段：不同目录互不串缓存', () => {
    expect(filesQueryKeys.dir('alice', '')).not.toEqual(filesQueryKeys.dir('alice', 'docs'));
  });
});
