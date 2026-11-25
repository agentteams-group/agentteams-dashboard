// 文件页「全局搜索」（跨目录名称 / 路径）纯逻辑：输入归一 / 匹配排序 /
// 结果路径 / 分页状态 / 递归平铺 → 搜索条目。无 React、无 window，可直接单测。
//
// 数据口径（组件侧）：首屏 = listRecursive(human, {limit: 1000}) 的递归平铺
// （控制器只返回文件，目录条目由路径派生）；后续经 nextKey 游标显式续拉。
// 复用的文件模型 / 名称比较 / 路径拼接全部来自 files-model，不另造一套。

import {
  baseName,
  compareEntryName,
  entryRowPath,
  parentDir,
} from '@/lib/files-model';
import {
  entryDisplayName,
  isEntryDir,
  type HumanFileEntry,
  type HumanFileRecursiveEntry,
} from '@/lib/human-files-api';

/** 触发搜索的最小字符数（更短只提示，不发请求）。 */
export const SEARCH_MIN_CHARS = 2;
/** 结果展示上限（超出提示继续输入缩小范围）。 */
export const SEARCH_RESULT_CAP = 200;
/** 首屏拉取上限（不自动无限拉取）。 */
export const SEARCH_FETCH_LIMIT = 1000;
/** 输入去抖（ms）。 */
export const SEARCH_DEBOUNCE_MS = 250;

export interface SearchQuery {
  /** 原始输入（未 trim——输入框回显用）。 */
  raw: string;
  /** trim 后的原文（提示用）。 */
  display: string;
  /** 小写归一的匹配串（匹配统一用它）。 */
  term: string;
  /** 有输入但不足最小长度（显示「输入至少 2 个字符」）。 */
  tooShort: boolean;
  /** 达到最小长度 → 可触发搜索。 */
  active: boolean;
}

export function parseSearchQuery(raw: unknown): SearchQuery {
  const source = typeof raw === 'string' ? raw : '';
  const display = source.trim();
  const term = display.toLowerCase();
  return {
    raw: source,
    display,
    term,
    tooShort: display.length > 0 && display.length < SEARCH_MIN_CHARS,
    active: term.length >= SEARCH_MIN_CHARS,
  };
}

/** 命中层级：0 = 名称前缀 / 1 = 名称包含 / 2 = 路径包含。 */
export type SearchRank = 0 | 1 | 2;

export interface RankedSearch {
  /** 按层级排序后的结果（最多 SEARCH_RESULT_CAP 条）。 */
  results: HumanFileEntry[];
  /** 匹配总数（含超出展示上限的部分）。 */
  matched: number;
  /** 匹配数超过展示上限（UI：「仅显示前 200 条…」）。 */
  capped: boolean;
}

/** 结果条目相对路径（目录路径无尾斜杠）。 */
export function resultRelPath(entry: HumanFileEntry): string {
  return entryRowPath(entry, '').replace(/\/+$/, '');
}

/** 结果条目显示名（目录 / 文件同口径；path 末段优先）。 */
export function searchEntryName(entry: HumanFileEntry): string {
  return baseName(resultRelPath(entry)) || entryDisplayName(entry);
}

/** 结果行的父目录（根层返回 ""）。 */
export function resultParentPath(entry: HumanFileEntry): string {
  return parentDir(resultRelPath(entry));
}

function rankOf(entry: HumanFileEntry, term: string): SearchRank | null {
  const name = searchEntryName(entry).toLowerCase();
  if (name.startsWith(term)) return 0;
  if (name.includes(term)) return 1;
  if (resultRelPath(entry).toLowerCase().includes(term)) return 2;
  return null;
}

/** 结果排序：层级升序 → 目录优先 → 名称 numeric / 中文升序（同名再按路径定序）。 */
function compareRanked(
  a: { entry: HumanFileEntry; rank: SearchRank },
  b: { entry: HumanFileEntry; rank: SearchRank },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const da = isEntryDir(a.entry);
  const db = isEntryDir(b.entry);
  if (da !== db) return da ? -1 : 1;
  const byName = compareEntryName(a.entry, b.entry);
  if (byName !== 0) return byName;
  return resultRelPath(a.entry).localeCompare(resultRelPath(b.entry), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

/** 过滤 + 排序 + 截断。未达最小长度 / 空查询 → 空结果。 */
export function rankSearchResults(
  entries: readonly HumanFileEntry[],
  query: string | SearchQuery,
): RankedSearch {
  const q = typeof query === 'string' ? parseSearchQuery(query) : query;
  if (!q.active) return { results: [], matched: 0, capped: false };
  const hits: { entry: HumanFileEntry; rank: SearchRank }[] = [];
  for (const entry of entries) {
    const rank = rankOf(entry, q.term);
    if (rank !== null) hits.push({ entry, rank });
  }
  hits.sort(compareRanked);
  const results = hits.slice(0, SEARCH_RESULT_CAP).map((hit) => hit.entry);
  return { results, matched: hits.length, capped: hits.length > results.length };
}

export interface SearchPageState {
  /** 已拉取条目数（含已加载的后续页）。 */
  loaded: number;
  /** 本次拉取上限（首屏 SEARCH_FETCH_LIMIT）。 */
  limit: number;
  /** 还有下一页（nextKey 非空——UI 显示「加载更多」）。 */
  hasMore: boolean;
  /** 已拉满首屏上限（UI：「结果基于前 N 项」）。 */
  atLimit: boolean;
}

/** 分页状态（首屏最多 SEARCH_FETCH_LIMIT 条；不自动无限拉取）。 */
export function searchPageState(inp: {
  entries: readonly HumanFileEntry[];
  nextKey: string | null | undefined;
  limit?: number;
}): SearchPageState {
  const limit =
    typeof inp.limit === 'number' && inp.limit > 0 ? inp.limit : SEARCH_FETCH_LIMIT;
  const loaded = inp.entries.length;
  return {
    loaded,
    limit,
    hasMore: typeof inp.nextKey === 'string' && inp.nextKey !== '',
    atLimit: loaded >= limit,
  };
}

/**
 * 递归平铺（控制器只返回文件条目）→ 搜索条目：文件原样 + 由路径派生的目录。
 * 目录去重（同一目录只出一条），祖先链逐级补齐，供「目录进入」与目录优先排序。
 */
export function searchEntriesFromRecursive(
  entries: readonly HumanFileRecursiveEntry[],
): HumanFileEntry[] {
  const files: HumanFileEntry[] = [];
  const dirs = new Map<string, HumanFileEntry>();
  for (const raw of entries) {
    const path = String(raw.path ?? '').replace(/\/+$/, '');
    if (!path) continue;
    files.push({
      name: baseName(path),
      type: 'file',
      size: raw.size,
      updatedAt: raw.updatedAt,
      etag: raw.etag,
      path,
    });
    let parent = parentDir(path);
    while (parent) {
      if (!dirs.has(parent)) {
        dirs.set(parent, {
          name: baseName(parent),
          type: 'directory',
          size: 0,
          path: parent,
        });
      }
      parent = parentDir(parent);
    }
  }
  return [...files, ...dirs.values()];
}
