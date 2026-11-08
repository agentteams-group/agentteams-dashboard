// 文件页刷新 / 缓存策略（stale-while-revalidate）。
//
// 纯逻辑，不依赖 React / fetch，便于直接单测：
//  * 新鲜期常量（staleTime / gcTime）集中一处，页面与测试共用同一口径；
//  * `shouldBackgroundRefresh`：页面回到可见 / 触发后台重取前的时间闸门；
//  * `pruneSelection`：刷新后把消失的条目从选择里摘掉（并报告摘掉了谁）；
//  * `mergeOptimisticRename`：重命名 / 移动的乐观缓存替换；
//  * `queryKeysForWrite`：写操作只失效相关 key（不一次清空搜索 + 回收站 + 递归）。

import type { HumanFileEntry } from '@/lib/human-files-api';

/** 目录 / 递归列表的新鲜期：窗口 focus 重取被它抑制（不会一 focus 就打请求）。 */
export const FILES_STALE_MS = 30_000;

/** 缓存保留期：离开目录 5 分钟内回来直接命中缓存，不再等网络。 */
export const FILES_GC_MS = 5 * 60_000;

/** 回收站变化慢，拉到 1 分钟。 */
export const TRASH_STALE_MS = 60_000;

/** 搜索结果 1 分钟：同一搜索词来回切换不重复扫全树。 */
export const SEARCH_STALE_MS = 60_000;

/** 页面从隐藏回到可见：距上次成功超过 60s 才后台重取。 */
export const VISIBLE_REFRESH_AFTER_MS = 60_000;

/** 同一 query 的最小重取间隔：并发去重闸门（在飞请求由 React Query 再合并）。 */
export const MIN_REFETCH_GAP_MS = 5_000;

/** 距上次成功是否该后台重取。
 *
 * `lastUpdatedAt` = React Query 的 `dataUpdatedAt`（epoch ms；0 / 未加载 → 必须取）；
 * 时钟回拨（last > now）视为不新鲜，避免用未来时间戳永久压制刷新。 */
export function shouldBackgroundRefresh(
  lastUpdatedAt: number | null | undefined,
  now: number,
  hiddenMs: number,
): boolean {
  if (!Number.isFinite(now)) return false;
  if (lastUpdatedAt == null || !Number.isFinite(lastUpdatedAt) || lastUpdatedAt <= 0) return true;
  if (lastUpdatedAt > now) return false;
  return now - lastUpdatedAt > hiddenMs;
}

export interface PrunedSelection {
  /** 仍可见的选择（全部可见时保持原引用，避免多余 re-render）。 */
  selected: Set<string>;
  /** 已被摘掉的路径（顺序 = 原选择顺序），供 UI 提示。 */
  removed: string[];
}

/** 选择剪枝：只保留 `paths` 里仍存在的路径。 */
export function pruneSelection(
  paths: readonly string[],
  selected: Iterable<string>,
): PrunedSelection {
  const visible = new Set(paths);
  const next = new Set<string>();
  const removed: string[] = [];
  for (const p of selected) {
    if (visible.has(p)) next.add(p);
    else removed.push(p);
  }
  return { selected: next, removed };
}

function lastSegment(path: string): string {
  const parts = path.split('/').filter((seg) => seg !== '');
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** 条目自身的行路径：新形态有 `path`，老形态只有 `name`（= 当前目录内名字）。 */
function rowPathOf(entry: HumanFileEntry): string {
  return (entry.path ?? entry.name).replace(/\/+$/, '');
}

/** 重命名 / 移动的乐观替换：命中 `from` 的条目换成 `to`，目录子项按前缀重写。
 *  没命中时返回原数组引用（调用方据此判断要不要 setQueryData）。 */
export function mergeOptimisticRename(
  entries: readonly HumanFileEntry[],
  from: string,
  to: string,
): HumanFileEntry[] {
  const source = from.replace(/\/+$/, '');
  const target = to.replace(/\/+$/, '');
  if (!source || !target || source === target) return entries as HumanFileEntry[];
  const sourceName = lastSegment(source);
  let changed = false;
  const out = entries.map((entry) => {
    const current = rowPathOf(entry);
    const hit = entry.path ? current === source : entry.name === sourceName;
    if (hit) {
      changed = true;
      return { ...entry, path: target, name: lastSegment(target) };
    }
    if (current.startsWith(`${source}/`)) {
      changed = true;
      const nextPath = `${target}${current.slice(source.length)}`;
      return { ...entry, path: nextPath, name: lastSegment(nextPath) };
    }
    return entry;
  });
  return changed ? out : (entries as HumanFileEntry[]);
}

/** 页面使用的查询 key（全部经此构造，失效时才不会漏 key / 打错 key）。 */
export const filesQueryKeys = {
  dir: (human: string, dir: string) => ['human-files', human, dir] as const,
  recursive: (human: string) => ['human-files-recursive', human] as const,
  search: (human: string) => ['human-files-search', human] as const,
  searchTerm: (human: string, term: string) => ['human-files-search', human, term] as const,
  trash: (human: string) => ['human-trash', human] as const,
  quota: (human: string) => ['human-quota', human] as const,
};

/** 写操作种类（决定失效面）。 */
export type FilesWriteKind =
  | 'upload'
  | 'create'
  | 'rename'
  | 'move'
  | 'delete'
  | 'restore'
  | 'purge'
  | 'quota';

export interface FilesWriteScope {
  kind: FilesWriteKind;
  human: string;
  /** 受影响的目录（当前目录 / 删除项所在目录 / 移动源目录）。 */
  dir: string;
  /** 移动 / 重命名的目标目录（同目录时可省略）。 */
  destDir?: string;
}

/** 写操作 → 需要失效的 query key 前缀。
 *
 * 刻意**不含** `human-files-search`：搜索有独立 60s 缓存 + keepPreviousData，
 * 一次写操作把搜索结果清空会让正在看的结果闪成空白（要新结果就改搜索词 / 等新鲜期过）。 */
export function queryKeysForWrite(
  scope: FilesWriteScope,
): ReadonlyArray<readonly unknown[]> {
  const { kind, human } = scope;
  if (!human) return [];
  if (kind === 'quota') return [filesQueryKeys.quota(human)];
  if (kind === 'purge') return [filesQueryKeys.trash(human), filesQueryKeys.quota(human)];

  const keys: (readonly unknown[])[] = [filesQueryKeys.dir(human, scope.dir)];
  if (scope.destDir != null && scope.destDir !== scope.dir) {
    keys.push(filesQueryKeys.dir(human, scope.destDir));
  }
  if (kind === 'delete' || kind === 'restore') keys.push(filesQueryKeys.trash(human));
  return [...keys, filesQueryKeys.recursive(human), filesQueryKeys.quota(human)];
}
