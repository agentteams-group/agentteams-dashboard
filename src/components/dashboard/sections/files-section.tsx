'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ChevronRight,
  Download,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  List,
  Loader2,
  RefreshCw,
  Search,
  Trash,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import {
  FILE_SORT_STORAGE_KEY,
  FILES_VIEW_STORAGE_KEY,
  clearSelection,
  clickSelection,
  collectTreeEntries,
  columnsFor,
  effectiveLayoutMode,
  entryRowPath,
  filesErrorText,
  flattenTree,
  fmtBytes,
  formatQuotaValue,
  isEditableText,
  isPageBlankClickTarget,
  isTreeNavKey,
  loadedChildCount,
  makeUploadItems,
  markUploadStatus,
  nextFileSort,
  panesFor,
  parentDir,
  parseFileSort,
  parseFilesView,
  quotaPercent,
  resolveTargetDir,
  rowClickIntent,
  selectAllState,
  selectedSummary,
  serializeFileSort,
  sortFileEntries,
  sortTreeLevels,
  startableIds,
  retryUpload,
  treeKeyNav,
  uploadProgress,
  withDirPaths,
  type FileSort,
  type FilesView,
  type SelectionSet,
  type TreeRow,
  type UploadItem,
} from '@/lib/files-model';
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
  type FilesWriteKind,
} from '@/lib/files-refresh';
import {
  humanFilesApi,
  type HumanFileEntry,
  type HumanFileListResponse,
  type HumanTrashEntry,
} from '@/lib/human-files-api';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_FETCH_LIMIT,
  parseSearchQuery,
  rankSearchResults,
  resultRelPath,
  searchEntriesFromRecursive,
  searchEntryName,
  searchPageState,
} from '@/lib/files-search';
import { saveBlob } from '@/lib/human-files-api';
import { ApiError } from '@/lib/api-error';
import { FileDropTarget } from './files/file-drop-target';
import {
  DeleteConfirmDialog,
  MoveDialog,
  NewFolderDialog,
  QuotaDialog,
  RenameDialog,
  TextEditorDialog,
  type FileOpTarget,
} from './files/files-dialogs';
import { FileDetailCard, DetailPlaceholder } from './files/file-detail';
import { FileSearchResults, type SearchRowActions } from './files/file-search-results';
import { GridView, ListView, TreeView, type EntryActions } from './files/file-views';
import { TrashDialog } from './files/trash-dialog';
import { UploadQueuePanel } from './files/upload-panel';

const ROOT_LABEL = '我的文件';

function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式 / 配额失败忽略 */
  }
}

/** sessionUser → human 名（Matrix localpart）。 */
function humanNameFromSession(user: string | null): string {
  if (!user) return '';
  const local = user.startsWith('@') ? user.slice(1).split(':')[0] : user;
  return local.split('@')[0] ?? local;
}

function statusOf(err: unknown): '' | '404' | 'err' {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 403) return '404';
    return 'err';
  }
  return err ? 'err' : '';
}

function entryToTarget(entry: HumanFileEntry, dirPath: string): FileOpTarget {
  return {
    path: entryRowPath(entry, dirPath),
    name: entry.name,
    isDir: entry.type === 'directory',
    size: entry.size,
  };
}

export interface FilesSectionProps {
  /** 仅测试/深链用：跳过人员选择。 */
  initialHuman?: string;
}

export function FilesSection({ initialHuman }: FilesSectionProps = {}) {
  const queryClient = useQueryClient();
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const sessionUser = useAgentTeamsStore((s) => s.sessionUser);
  const { data: humans } = useHumans();
  const canAdmin = userLevel >= 3;

  const [humanName, setHumanName] = useState(initialHuman ?? '');
  useEffect(() => {
    if (initialHuman) return;
    if (canAdmin) {
      if (humans && humans.length > 0 && !humans.some((h) => h.name === humanName)) {
        setHumanName(humans[0].name);
      }
      return;
    }
    const fallback = humanNameFromSession(sessionUser);
    if (fallback && fallback !== humanName) setHumanName(fallback);
  }, [canAdmin, humans, humanName, initialHuman, sessionUser]);

  const [dirPath, setDirPath] = useState('');
  // 全局搜索：输入（原始）→ 250ms 去抖后的 term → 递归平铺客户端过滤。
  const [searchRaw, setSearchRaw] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchQuery = useMemo(() => parseSearchQuery(searchRaw), [searchRaw]);
  const [view, setView] = useState<FilesView>(() => parseFilesView(readStorage(FILES_VIEW_STORAGE_KEY)));
  const [sort, setSort] = useState<FileSort>(() => parseFileSort(readStorage(FILE_SORT_STORAGE_KEY)));
  const [recursive, setRecursive] = useState(false);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectionSet>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [uploadDir, setUploadDir] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [children, setChildren] = useState<Map<string, HumanFileEntry[]>>(() => new Map());
  const [treeLoading, setTreeLoading] = useState<Set<string>>(() => new Set());
  const [treeErrors, setTreeErrors] = useState<Record<string, string>>({});

  const [trashOpen, setTrashOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileOpTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<FileOpTarget | null>(null);
  const [editTarget, setEditTarget] = useState<FileOpTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileOpTarget | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [showUploads, setShowUploads] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFiles = useRef(new Map<string, File>());
  const uploadAborts = useRef(new Map<string, AbortController>());

  // 清空搜索 = 回到当前目录：输入 / 去抖 term / 搜索态焦点一起归零
  //（命中的文件可能不在当前目录，焦点留着会让详情槽悬空）。
  const clearSearch = useCallback(() => {
    setSearchRaw('');
    setSearchTerm('');
    setFocusedPath(null);
  }, []);

  // 输入去抖 250ms；<2 字符 / 清空 → term 归空（不触发请求）。
  useEffect(() => {
    const id = setTimeout(() => {
      setSearchTerm(searchQuery.active ? searchQuery.term : '');
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchQuery.term, searchQuery.active]);

  // 换人 = 换文件区：目录 / 焦点 / 选择 / 上传目标一律归零，避免跨人残留。
  useEffect(() => {
    setDirPath('');
    setFocusedPath(null);
    setSelected(clearSelection());
    setAnchor(null);
    setUploadDir('');
    setExpanded(new Set());
    setChildren(new Map());
    clearSearch();
  }, [clearSearch, humanName]);

  useEffect(() => writeStorage(FILES_VIEW_STORAGE_KEY, view), [view]);
  useEffect(() => writeStorage(FILE_SORT_STORAGE_KEY, serializeFileSort(sort)), [sort]);

  // ── 数据 ───────────────────────────────────────────────────────────
  // 缓存策略见 lib/files-refresh.ts：stale-while-revalidate —— 有旧数据先渲染，
  // 后台重取只更新数据不换骨架；窗口 focus 仅在过期后才重取（不被 staleTime 绕过）。
  const dirQuery = useQuery({
    queryKey: filesQueryKeys.dir(humanName, dirPath),
    queryFn: ({ signal }) => humanFilesApi.listDirectory(humanName, dirPath, { signal }),
    enabled: Boolean(humanName) && !recursive,
    retry: false,
    staleTime: FILES_STALE_MS,
    gcTime: FILES_GC_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const recursiveQuery = useInfiniteQuery({
    queryKey: filesQueryKeys.recursive(humanName),
    queryFn: ({ pageParam, signal }) =>
      humanFilesApi.listRecursive(humanName, { cursor: pageParam ?? undefined, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextKey ?? undefined,
    enabled: Boolean(humanName) && recursive,
    retry: false,
    staleTime: FILES_STALE_MS,
    gcTime: FILES_GC_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const trashQuery = useQuery({
    queryKey: filesQueryKeys.trash(humanName),
    queryFn: ({ signal }) => humanFilesApi.listTrash(humanName, { signal }),
    enabled: Boolean(humanName),
    retry: false,
    staleTime: TRASH_STALE_MS,
    gcTime: FILES_GC_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const quotaQuery = useQuery({
    queryKey: filesQueryKeys.quota(humanName),
    queryFn: ({ signal }) => humanFilesApi.getQuota(humanName, { signal }),
    enabled: Boolean(humanName),
    retry: false,
    staleTime: FILES_STALE_MS,
    gcTime: FILES_GC_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const directoryEntries = useMemo(
    () => withDirPaths(dirQuery.data?.entries ?? [], dirPath),
    [dirQuery.data, dirPath],
  );

  const recursiveEntries = useMemo<HumanFileEntry[]>(() => {
    const pages = recursiveQuery.data?.pages ?? [];
    return pages.flatMap((page) =>
      page.entries.map((e) => ({
        name: e.path.split('/').pop() || e.path,
        type: 'file' as const,
        size: e.size,
        updatedAt: e.updatedAt,
        path: e.path,
        etag: e.etag,
      })),
    );
  }, [recursiveQuery.data]);

  const entries = recursive ? recursiveEntries : directoryEntries;

  const loading = recursive ? recursiveQuery.isPending : dirQuery.isPending;
  // 有旧数据就先把错误降级成「部分更新失败」提示，不拿错误占位替换整份列表
  // （递归翻页失败尤其如此：已加载页必须留在屏上）。
  const listError = recursive
    ? recursiveQuery.data
      ? null
      : recursiveQuery.error
    : dirQuery.data
      ? null
      : dirQuery.error;
  const listStatus = listError ? statusOf(listError) : '';
  // 旧数据仍在屏上时的「部分更新失败」文案（错误占位只留给首屏失败）。
  // 翻页失败由列表底部的专属提示承载，这里不重复报。
  const pageError = recursive && recursiveQuery.isFetchNextPageError;
  const staleErrorText = !loading && !listStatus && !pageError
    ? recursive
      ? recursiveQuery.isError
        ? filesErrorText(recursiveQuery.error)
        : ''
      : dirQuery.isError
        ? filesErrorText(dirQuery.error)
        : ''
    : '';

  // 全局搜索数据：首屏 1000 条递归平铺；后续 cursor 只在「加载更多」时显式续拉。
  const searchData = useInfiniteQuery({
    queryKey: filesQueryKeys.searchTerm(humanName, searchTerm),
    queryFn: ({ pageParam, signal }) =>
      humanFilesApi.listRecursive(
        humanName,
        pageParam
          ? { cursor: pageParam, limit: SEARCH_FETCH_LIMIT, signal }
          : { limit: SEARCH_FETCH_LIMIT, signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextKey ?? undefined,
    enabled: Boolean(humanName) && searchQuery.active && searchTerm !== '',
    retry: false,
    staleTime: SEARCH_STALE_MS,
    gcTime: FILES_GC_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // 换词时旧结果留屏到新结果到达（配合下面的「搜索中」指示）。
    placeholderData: keepPreviousData,
  });

  // 404/403/501（端点不可用）→ 降级「全局搜索不可用」，当前目录内容照常。
  const searchStatus = searchData.error instanceof ApiError ? searchData.error.status : 0;
  const searchUnavailable =
    searchStatus === 404 || searchStatus === 403 || searchStatus === 501;
  const searchOn = searchQuery.active && !searchUnavailable;

  const searchEntries = useMemo<HumanFileEntry[]>(() => {
    const pages = searchData.data?.pages ?? [];
    return searchEntriesFromRecursive(pages.flatMap((page) => page.entries));
  }, [searchData.data]);

  const searchRanked = useMemo(
    () => rankSearchResults(searchEntries, searchQuery),
    // searchQuery 每次渲染新建 → 依赖真正决定匹配的字段。
    [searchEntries, searchQuery.active, searchQuery.term],
  );

  const searchPage = useMemo(() => {
    const pages = searchData.data?.pages ?? [];
    const last = pages.length > 0 ? pages[pages.length - 1] : null;
    return searchPageState({
      entries: searchEntries,
      nextKey: searchData.hasNextPage ? (last?.nextKey ?? '') : null,
      limit: SEARCH_FETCH_LIMIT,
    });
  }, [searchData.data, searchData.hasNextPage, searchEntries]);

  const searchPending = searchOn && (searchTerm === '' || searchData.isPending);
  const searchErrorText =
    searchData.error && !searchUnavailable ? filesErrorText(searchData.error) : '';

  const sortedEntries = useMemo(() => sortFileEntries(entries, sort), [entries, sort]);

  const sortedChildren = useMemo(() => {
    if (view !== 'tree') return children;
    const sorted = sortTreeLevels(sortedEntries, children, sort);
    return sorted.children;
  }, [children, sortedEntries, sort, view]);

  const treeRows: TreeRow[] = useMemo(
    () =>
      view === 'tree'
        ? flattenTree({ roots: sortedEntries, children: sortedChildren, expanded })
        : [],
    [expanded, sortedChildren, sortedEntries, view],
  );

  const knownEntries = useMemo(
    () =>
      view === 'tree'
        ? collectTreeEntries(sortedEntries, sortedChildren)
        : sortedEntries,
    [sortedChildren, sortedEntries, view],
  );

  const visiblePaths = useMemo(
    () =>
      view === 'tree'
        ? treeRows.map((row) => row.path)
        : sortedEntries.map((e) => entryRowPath(e, dirPath)),
    [dirPath, sortedEntries, treeRows, view],
  );

  const detailEntry = useMemo(() => {
    if (!focusedPath) return null;
    const inDir = knownEntries.find((e) => entryRowPath(e, dirPath) === focusedPath);
    if (inDir) return inDir;
    // 搜索结果里的文件不在当前目录 → 详情槽回落到搜索条目。
    return searchEntries.find((e) => entryRowPath(e, '') === focusedPath) ?? null;
  }, [dirPath, focusedPath, knownEntries, searchEntries]);

  const knownPathSet = useMemo(
    () => new Set(knownEntries.map((e) => entryRowPath(e, dirPath))),
    [dirPath, knownEntries],
  );

  // 选择只保留仍可见的路径（换视图 / 折叠树 / 数据刷新都走这里，静默）。
  useEffect(() => {
    setSelected((prev) => {
      const next = pruneSelection(visiblePaths, prev);
      return next.removed.length === 0 ? prev : next.selected;
    });
  }, [visiblePaths]);

  // 数据变化后消失的条目：摘出选择 / 关掉悬空详情，并提示一次。
  const selectedRef = useRef<SelectionSet>(selected);
  const focusedRef = useRef<string | null>(focusedPath);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    focusedRef.current = focusedPath;
  }, [focusedPath]);

  const prevKnownRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const prev = prevKnownRef.current;
    prevKnownRef.current = knownPathSet;
    // 搜索态展示的是另一份结果集，目录缓存刷新不该牵动它。
    if (!prev || prev.size === 0 || searchOn) return;
    const vanished: string[] = [];
    for (const p of prev) if (!knownPathSet.has(p)) vanished.push(p);
    if (vanished.length === 0) return;
    const dropped = vanished.filter((p) => selectedRef.current.has(p));
    if (dropped.length > 0) {
      setSelected((cur) => {
        const next = pruneSelection(visiblePaths, cur);
        return next.removed.length === 0 ? cur : next.selected;
      });
      toast.info(`${dropped.length} 个已选项已不存在，已从选择中移除`, {
        id: 'files-selection-pruned',
      });
    }
    if (focusedRef.current && vanished.includes(focusedRef.current)) setFocusedPath(null);
  }, [knownPathSet, searchOn, visiblePaths]);

  const targetDir = resolveTargetDir(uploadDir, dirPath);

  // ── 刷新 / 失效（stale-while-revalidate）─────────────────────────────
  /** 当前视图必要 query（目录 / 递归当前页 / quota）——手动刷新只碰这些。 */
  const refetchCurrent = useCallback(() => {
    if (!humanName) return;
    if (searchOn) {
      void searchData.refetch();
      return;
    }
    if (recursive) void recursiveQuery.refetch();
    else void dirQuery.refetch();
    void quotaQuery.refetch();
  }, [dirQuery, humanName, quotaQuery, recursive, recursiveQuery, searchData, searchOn]);

  /** 写操作后：只失效相关 key（搜索快照与无关目录不动）。 */
  const afterWrite = useCallback(
    (kind: FilesWriteKind, options: { dir?: string; destDir?: string } = {}) => {
      if (!humanName) return;
      const keys = queryKeysForWrite({
        kind,
        human: humanName,
        dir: options.dir ?? dirPath,
        destDir: options.destDir,
      });
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
      if (kind !== 'quota' && kind !== 'purge') {
        // 结构变了：树懒加载的分支缓存既可能多也可能少，丢掉重拉。
        setChildren(new Map());
        setExpanded(new Set());
        setTreeErrors({});
      }
    },
    [dirPath, humanName, queryClient],
  );

  /** 编辑器保存 / 上传队列收尾：内容变化但不重置视图状态。 */
  const mutateDone = useCallback(() => afterWrite('upload'), [afterWrite]);

  // ── 乐观缓存补丁（返回回滚）─────────────────────────────────────────
  const patchDirCache = useCallback(
    (dir: string, patch: (_entries: HumanFileEntry[]) => HumanFileEntry[]): (() => void) => {
      const key = filesQueryKeys.dir(humanName, dir);
      const prev = queryClient.getQueryData<HumanFileListResponse>(key);
      if (!prev) return () => {};
      const next = patch(prev.entries);
      if (next === prev.entries) return () => {};
      queryClient.setQueryData<HumanFileListResponse>(key, { ...prev, entries: next });
      return () => queryClient.setQueryData(key, prev);
    },
    [humanName, queryClient],
  );

  const upsertInDir = useCallback(
    (dir: string, entry: HumanFileEntry): (() => void) =>
      patchDirCache(dir, (entries) => {
        const target = entryRowPath(entry, dir);
        const index = entries.findIndex((e) => entryRowPath(e, dir) === target);
        if (index < 0) return [...entries, entry];
        const next = entries.slice();
        next[index] = { ...entries[index], ...entry };
        return next;
      }),
    [patchDirCache],
  );

  const removeFromDir = useCallback(
    (dir: string, path: string): (() => void) =>
      patchDirCache(dir, (entries) => {
        const next = entries.filter((e) => entryRowPath(e, dir) !== path);
        return next.length === entries.length ? entries : next;
      }),
    [patchDirCache],
  );

  /** 重命名 / 移动的乐观替换：同目录就地换名，跨目录从源目录摘下再插到目标目录。 */
  const optimisticMove = useCallback(
    (entry: HumanFileEntry | null, from: string, to: string): (() => void) => {
      const sourceDir = parentDir(from);
      const destDir = parentDir(to);
      if (sourceDir === destDir) {
        return patchDirCache(sourceDir, (entries) => mergeOptimisticRename(entries, from, to));
      }
      const undoSource = removeFromDir(sourceDir, from);
      const moved = entry ? mergeOptimisticRename([entry], from, to)[0] : null;
      const undoDest = moved ? upsertInDir(destDir, moved) : () => {};
      return () => {
        undoDest();
        undoSource();
      };
    },
    [patchDirCache, removeFromDir, upsertInDir],
  );

  // 页面隐藏不轮询；回到可见且距上次成功 >60s 才后台重取（不换骨架、不清搜索）。
  const lastAutoRefresh = useRef(0);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'hidden' || !humanName) return;
      const now = Date.now();
      if (!shouldBackgroundRefresh(lastAutoRefresh.current, now, MIN_REFETCH_GAP_MS)) return;
      const keys: ReadonlyArray<readonly unknown[]> = searchOn
        ? [filesQueryKeys.searchTerm(humanName, searchTerm)]
        : recursive
          ? [filesQueryKeys.recursive(humanName), filesQueryKeys.quota(humanName)]
          : [filesQueryKeys.dir(humanName, dirPath), filesQueryKeys.quota(humanName)];
      const lastSuccess = keys.reduce(
        (latest, key) => Math.max(latest, queryClient.getQueryState(key)?.dataUpdatedAt ?? 0),
        0,
      );
      if (!shouldBackgroundRefresh(lastSuccess, now, VISIBLE_REFRESH_AFTER_MS)) return;
      lastAutoRefresh.current = now;
      for (const key of keys) void queryClient.refetchQueries({ queryKey: key, type: 'active' });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [dirPath, humanName, queryClient, recursive, searchOn, searchTerm]);

  const refreshing = searchOn
    ? searchData.isFetching
    : recursive
      ? recursiveQuery.isFetching
      : dirQuery.isFetching;
  // 已有数据时的后台更新：给用户一条轻量提示，不拿骨架盖住列表。
  const backgroundUpdating = !loading && (refreshing || quotaQuery.isFetching);

  // ── 布局测量 ───────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [listWidth, setListWidth] = useState(0);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const container = containerRef.current;
    const list = listRef.current;
    const ro = new ResizeObserver(() => {
      if (container) setContainerWidth(container.getBoundingClientRect().width || container.clientWidth || 0);
      if (list) setListWidth(list.getBoundingClientRect().width || list.clientWidth || 0);
    });
    if (container) ro.observe(container);
    if (list) ro.observe(list);
    return () => ro.disconnect();
  }, []);

  const layout = effectiveLayoutMode({ containerWidth, listWidth, listMeasured: listWidth > 0 });
  const listWidthForColumns = layout === 'split' ? listWidth || containerWidth - 392 : containerWidth;
  const columns = columnsFor(listWidthForColumns, multiSelect);
  const panes = panesFor(layout, Boolean(focusedPath && detailEntry));

  // ── 选择 / 焦点 ─────────────────────────────────────────────────────
  const clearFocusAndSelection = useCallback(() => {
    setFocusedPath(null);
    setSelected(clearSelection());
    setAnchor(null);
    setMultiSelect(false);
    setUploadDir('');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (trashOpen || quotaOpen || newFolderOpen || renameTarget || moveTarget || editTarget || deleteTarget) return;
      // 搜索态：Esc 先清空搜索并回到当前目录（再按才清选择 / 焦点）。
      if (searchRaw !== '') {
        clearSearch();
        return;
      }
      clearFocusAndSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    clearFocusAndSelection,
    clearSearch,
    deleteTarget,
    editTarget,
    moveTarget,
    newFolderOpen,
    quotaOpen,
    renameTarget,
    searchRaw,
    trashOpen,
  ]);

  const onRowClick = useCallback(
    (entry: HumanFileEntry, e: React.MouseEvent | null) => {
      const path = entryRowPath(entry, dirPath);
      const isDir = entry.type === 'directory';
      const intent = rowClickIntent({
        multiSelect,
        shiftKey: Boolean(e?.shiftKey),
        toggleKey: Boolean(e?.ctrlKey || e?.metaKey),
      });
      setFocusedPath(path);
      if (view === 'tree') setUploadDir(isDir ? path : '');
      if (intent.focusOnly) return;
      if (intent.enterMulti) setMultiSelect(true);
      const prevFocus = focusedPath;
      const anchorPath =
        anchor ??
        (prevFocus !== null && prevFocus !== path && visiblePaths.includes(prevFocus) ? prevFocus : null);
      const r = clickSelection(selected, path, {
        shiftKey: intent.range,
        toggleKey: intent.toggle,
        anchor: anchorPath,
        paths: visiblePaths,
      });
      setSelected(new Set(r.selected));
      setAnchor(r.anchor);
    },
    [anchor, dirPath, focusedPath, multiSelect, selected, view, visiblePaths],
  );

  const onToggleSelect = useCallback(
    (entry: HumanFileEntry, e: React.MouseEvent | null) => {
      const path = entryRowPath(entry, dirPath);
      setMultiSelect(true);
      setSelected((prev) => {
        let next: Set<string>;
        if (e?.shiftKey && anchor) {
          const ai = visiblePaths.indexOf(anchor);
          const bi = visiblePaths.indexOf(path);
          if (ai >= 0 && bi >= 0) {
            const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
            next = new Set(prev);
            for (let i = lo; i <= hi; i += 1) next.add(visiblePaths[i]);
            return next;
          }
        }
        next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setAnchor(path);
    },
    [anchor, dirPath, visiblePaths],
  );

  const onTreeRowClick = useCallback(
    (row: TreeRow, e: React.MouseEvent) => {
      onRowClick(row.entry, e);
      setUploadDir(row.isDir ? row.path : '');
    },
    [onRowClick],
  );

  const toggleMultiSelect = useCallback(() => {
    setMultiSelect((prev) => {
      if (prev) {
        setSelected(clearSelection());
        setAnchor(null);
      }
      return !prev;
    });
  }, []);

  // ── 目录导航 ───────────────────────────────────────────────────────
  const enterDir = useCallback((dir: string) => {
    setDirPath(dir);
    setRecursive(false);
    setFocusedPath(null);
    setSelected(clearSelection());
    setAnchor(null);
    setUploadDir('');
    setExpanded(new Set());
    setChildren(new Map());
  }, []);

  /** 搜索结果行：目录 = 进入并清搜索；文件 = 选中详情（保留结果）。 */
  const activateSearchResult = useCallback(
    (entry: HumanFileEntry) => {
      const path = resultRelPath(entry);
      if (entry.type === 'directory') {
        enterDir(path);
        clearSearch();
        return;
      }
      setFocusedPath(path);
    },
    [clearSearch, enterDir],
  );

  // ── 树懒加载 / 键盘 ────────────────────────────────────────────────
  const toggleExpand = useCallback(
    async (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      if (children.has(path) || treeLoading.has(path)) return;
      setTreeLoading((prev) => new Set(prev).add(path));
      try {
        const res = await humanFilesApi.listDirectory(humanName, path);
        setChildren((prev) => new Map(prev).set(path, withDirPaths(res.entries, path)));
        setTreeErrors((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
      } catch (err) {
        setTreeErrors((prev) => ({ ...prev, [path]: filesErrorText(err) }));
      } finally {
        setTreeLoading((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [children, humanName, treeLoading],
  );

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    const focusedRow = treeRows.find((row) => row.path === focusedPath);
    if (e.key === ' ') {
      e.preventDefault();
      if (!focusedRow) return;
      if (focusedRow.isDir) void toggleExpand(focusedRow.path);
      else onToggleSelect(focusedRow.entry, null);
      return;
    }
    if (!isTreeNavKey(e.key)) return;
    e.preventDefault();
    const index = treeRows.findIndex((row) => row.path === focusedPath);
    const cur = index < 0 ? 0 : index;
    if (e.key === 'ArrowLeft') {
      const row = treeRows[cur];
      if (row?.isDir && row.expanded) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(row.path);
          return next;
        });
      }
      return;
    }
    const nextIndex = treeKeyNav({ rows: treeRows, index: cur }, e.key, (p) => void toggleExpand(p));
    if (e.key === 'Enter') {
      const row = treeRows[nextIndex];
      if (row && !row.isDir) onRowClick(row.entry, null);
      return;
    }
    const row = treeRows[nextIndex];
    if (row) {
      setFocusedPath(row.path);
      setUploadDir(row.isDir ? row.path : '');
    }
  };

  // ── 下载 ───────────────────────────────────────────────────────────
  const doDownload = useCallback(
    async (path: string, name: string, size?: number): Promise<boolean> => {
      try {
        const blob = await humanFilesApi.download(humanName, path, { size });
        saveBlob(blob, name.split('/').pop() || name);
        return true;
      } catch (err) {
        toast.error('下载失败', { description: filesErrorText(err) });
        return false;
      }
    },
    [humanName],
  );

  // ── 上传 ───────────────────────────────────────────────────────────
  const enqueueFiles = useCallback(
    (files: { file: File; relPath: string }[], dir: string) => {
      if (files.length === 0) return;
      const prefix = `${Date.now()}:`;
      const items = makeUploadItems(
        files.map((f) => ({ name: f.file.name, size: f.file.size, relPath: f.relPath })),
        dir,
        prefix,
      );
      items.forEach((item, i) => uploadFiles.current.set(item.id, files[i].file));
      setUploadItems((prev) => [...prev, ...items]);
      setShowUploads(true);
    },
    [],
  );

  const runUpload = useCallback(
    async (item: UploadItem) => {
      const file = uploadFiles.current.get(item.id);
      if (!file) {
        setUploadItems((prev) => markUploadStatus(prev, item.id, 'failed', '文件已失效，请重新选择'));
        return;
      }
      const ctrl = new AbortController();
      uploadAborts.current.set(item.id, ctrl);
      // 拖入目录：先建相对子目录（.keep 占位，失败不阻断——根目录仍可写）。
      const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
      if (parent) {
        try {
          await humanFilesApi.makeDirectory(humanName, parent);
        } catch {
          /* 子目录创建失败由上传错误统一提示 */
        }
      }
      try {
        await humanFilesApi.uploadFile(humanName, item.path, file, { signal: ctrl.signal });
        setUploadItems((prev) => markUploadStatus(prev, item.id, 'success'));
        // 逐项落进当前目录缓存：队列跑完不再整页刷新，只有「收尾」才做一次校正。
        upsertInDir(parent, {
          name: item.path.split('/').pop() ?? item.name,
          path: item.path,
          type: 'file',
          size: file.size,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        setUploadItems((prev) =>
          markUploadStatus(prev, item.id, 'failed', filesErrorText(err)),
        );
      } finally {
        uploadAborts.current.delete(item.id);
      }
    },
    [humanName, upsertInDir],
  );

  const progress = uploadProgress(uploadItems);

  useEffect(() => {
    const ids = startableIds(uploadItems);
    if (ids.length === 0) return;
    for (const id of ids) {
      const item = uploadItems.find((it) => it.id === id);
      if (!item) continue;
      setUploadItems((prev) => markUploadStatus(prev, id, 'uploading'));
      void runUpload(item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadItems]);

  const completedRef = useRef('');
  useEffect(() => {
    if (progress.total === 0) return;
    const key = `${progress.success}:${progress.failed}:${progress.total}`;
    if (progress.finished === progress.total && progress.success > 0 && completedRef.current !== key) {
      completedRef.current = key;
      mutateDone();
    }
  }, [mutateDone, progress]);

  const cancelUpload = (id: string) => {
    uploadAborts.current.get(id)?.abort();
    uploadAborts.current.delete(id);
    uploadFiles.current.delete(id);
    setUploadItems((prev) => {
      const item = prev.find((it) => it.id === id);
      if (!item) return prev;
      if (item.status === 'waiting') return prev.filter((it) => it.id !== id);
      return markUploadStatus(prev, id, 'failed', '已取消');
    });
  };

  const retryOne = (id: string) => {
    setUploadItems((prev) => retryUpload(prev, id));
  };

  const onPick = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    enqueueFiles(
      Array.from(fileList).map((file) => ({ file, relPath: file.name })),
      targetDir,
    );
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── 写操作 ─────────────────────────────────────────────────────────
  const ensureNoConflict = async (target: string) => {
    const parent = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '';
    const name = target.split('/').pop() ?? target;
    const res = await humanFilesApi.listDirectory(humanName, parent);
    if (res.entries.some((e) => e.name === name)) {
      const err = new ApiError('目标路径已存在', 409, target);
      throw err;
    }
  };

  const collectFilesUnder = async (root: string): Promise<string[]> => {
    const out: string[] = [];
    const queue: string[] = [root];
    for (let guard = 0; queue.length > 0 && guard < 200; guard += 1) {
      const dir = queue.shift() as string;
      const res = await humanFilesApi.listDirectory(humanName, dir);
      for (const e of res.entries) {
        const child = entryRowPath(e, dir);
        if (e.type === 'directory') queue.push(child);
        else out.push(child);
      }
    }
    return out;
  };

  /** 重命名/移动 = 读→写→删（控制器无 move 端点；目录逐文件）。 */
  const copyAndRemove = async (from: string, to: string, isDir: boolean) => {
    await ensureNoConflict(to);
    if (!isDir) {
      const blob = await humanFilesApi.download(humanName, from);
      await humanFilesApi.writeFile(humanName, to, blob);
      const { trashId } = await humanFilesApi.deleteFile(humanName, from);
      if (trashId) await humanFilesApi.purgeTrash(humanName, trashId);
      return;
    }
    const files = await collectFilesUnder(from);
    if (files.length === 0) {
      await humanFilesApi.makeDirectory(humanName, to);
    }
    for (const file of files) {
      const rel = file === from ? '' : file.slice(from.length + 1);
      if (!rel) continue;
      const target = `${to}/${rel}`;
      const blob = await humanFilesApi.download(humanName, file);
      await humanFilesApi.writeFile(humanName, target, blob);
      const { trashId } = await humanFilesApi.deleteFile(humanName, file);
      if (trashId) await humanFilesApi.purgeTrash(humanName, trashId);
    }
  };

  const submitRename = async (plan: { from: string; to: string }) => {
    const entry = knownEntries.find((e) => entryRowPath(e, dirPath) === plan.from) ?? null;
    // 先换名（同目录就地替换 path），失败回滚并让弹窗显示错误。
    const rollback = optimisticMove(entry, plan.from, plan.to);
    try {
      await copyAndRemove(plan.from, plan.to, entry?.type === 'directory');
      if (focusedPath === plan.from) setFocusedPath(plan.to);
      afterWrite('rename', { dir: parentDir(plan.from), destDir: parentDir(plan.to) });
    } catch (err) {
      rollback();
      toast.error('重命名失败', { description: filesErrorText(err) });
      throw err;
    }
  };

  const submitMove = async (plan: { from: string; to: string }) => {
    const entry = knownEntries.find((e) => entryRowPath(e, dirPath) === plan.from) ?? null;
    const rollback = optimisticMove(entry, plan.from, plan.to);
    try {
      await copyAndRemove(plan.from, plan.to, entry?.type === 'directory');
      if (focusedPath === plan.from) setFocusedPath(plan.to);
      afterWrite('move', { dir: parentDir(plan.from), destDir: parentDir(plan.to) });
    } catch (err) {
      rollback();
      toast.error('移动失败', { description: filesErrorText(err) });
      throw err;
    }
  };

  const deleteEntry = async (path: string) => {
    const { trashId } = await humanFilesApi.deleteFile(humanName, path);
    return trashId;
  };

  const confirmDelete = async (purge: boolean) => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    // 先从当前目录摘掉（回收站可见性由失效保证），失败回滚。
    const rollback = removeFromDir(parentDir(target.path), target.path);
    let trashId = '';
    try {
      trashId = await deleteEntry(target.path);
    } catch (err) {
      rollback();
      toast.error('删除失败', { description: filesErrorText(err) });
      throw err;
    }
    if (purge && trashId) {
      try {
        await humanFilesApi.purgeTrash(humanName, trashId);
      } catch (err) {
        toast.error('彻底删除失败', { description: filesErrorText(err) });
      }
    } else if (trashId) {
      // 软删成功：撤销条 8s（复用 toast action 形态）。
      toast('已移入回收站', {
        description: target.name,
        duration: 8000,
        action: {
          label: '撤销',
          onClick: () => {
            void humanFilesApi
              .restoreTrash(humanName, trashId, false)
              .then(() => afterWrite('restore', { dir: parentDir(target.path) }))
              .catch((err) => toast.error('撤销失败', { description: filesErrorText(err) }));
          },
        },
      });
    }
    if (focusedPath === target.path) setFocusedPath(null);
    afterWrite(purge ? 'purge' : 'delete', { dir: parentDir(target.path) });
  };

  const confirmBatchDelete = async () => {
    const targets = knownEntries.filter((e) => selected.has(entryRowPath(e, dirPath)));
    const files = targets.filter((e) => e.type === 'file');
    const skippedDirs = targets.length - files.length;
    const deleted: string[] = [];
    let failed = 0;
    let firstError = '';
    for (const e of files) {
      const path = entryRowPath(e, dirPath);
      try {
        await deleteEntry(path);
        deleted.push(path);
        removeFromDir(parentDir(path), path);
      } catch (err) {
        failed += 1;
        if (!firstError) firstError = filesErrorText(err);
      }
    }
    setSelected(clearSelection());
    setAnchor(null);
    setFocusedPath(null);
    // 批量删除只重建当前目录（+ 回收站/配额），已成功的逐项摘掉，不整页刷新。
    if (deleted.length > 0) afterWrite('delete');
    if (skippedDirs > 0) {
      toast.warning(`目录不支持批量删除，已跳过 ${skippedDirs} 个`);
    }
    toast[failed > 0 ? 'error' : 'success'](`删除完成：成功 ${deleted.length} 项${failed ? `，失败 ${failed} 项（${firstError}）` : ''}`);
  };

  const batchDownload = async () => {
    const targets = knownEntries.filter((e) => selected.has(entryRowPath(e, dirPath)));
    const files = targets.filter((e) => e.type === 'file');
    const skipped = targets.length - files.length;
    if (skipped > 0) toast.warning(`目录不支持下载，已跳过 ${skipped} 个`);
    let failed = 0;
    for (const e of files) {
      const ok = await doDownload(entryRowPath(e, dirPath), e.name, e.size);
      if (!ok) failed += 1;
    }
    if (failed > 0) toast.error(`下载完成，失败 ${failed} 项`);
  };

  const onCreateFolder = async (name: string) => {
    const dir = targetDir ? `${targetDir}/${name}` : name;
    const rollback = upsertInDir(parentDir(dir), {
      name,
      path: dir,
      type: 'directory',
      size: 0,
      updatedAt: new Date().toISOString(),
    });
    try {
      await humanFilesApi.makeDirectory(humanName, dir);
      afterWrite('create', { dir: parentDir(dir) });
    } catch (err) {
      rollback();
      toast.error('新建文件夹失败', { description: filesErrorText(err) });
      throw err;
    }
  };

  const onDrop = (files: { file: File; relPath: string }[], truncated: boolean) => {
    if (truncated) toast.warning('已按 200 文件 / 200 MB 上限截断');
    enqueueFiles(files, targetDir);
  };

  // ── 派生 UI ─────────────────────────────────────────────────────────
  const selectionSummary = useMemo(() => {
    const list = knownEntries.map((e) => ({
      path: entryRowPath(e, dirPath),
      size: e.size,
    }));
    return selectedSummary(list, selected);
  }, [dirPath, knownEntries, selected]);

  const knownDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const e of knownEntries) {
      if (e.type !== 'directory') continue;
      dirs.add(entryRowPath(e, dirPath));
    }
    return [...dirs].sort();
  }, [dirPath, knownEntries]);

  const crumbs = useMemo(() => {
    const parts = dirPath.split('/').filter(Boolean);
    const list = [{ label: ROOT_LABEL, path: '' }];
    parts.forEach((part, i) => {
      list.push({ label: part, path: parts.slice(0, i + 1).join('/') });
    });
    return list;
  }, [dirPath]);

  const entryActions: EntryActions = {
    onDetails: (entry) => {
      setFocusedPath(entryRowPath(entry, dirPath));
      if (view === 'tree' && entry.type === 'directory') setUploadDir(entryRowPath(entry, dirPath));
    },
    onDownload: (entry) => void doDownload(entryRowPath(entry, dirPath), entry.name, entry.size),
    onRename: (entry) => setRenameTarget(entryToTarget(entry, dirPath)),
    onMove: (entry) => setMoveTarget(entryToTarget(entry, dirPath)),
    onEdit: (entry) => setEditTarget(entryToTarget(entry, dirPath)),
    onDelete: (entry) => setDeleteTarget(entryToTarget(entry, dirPath)),
    editable: (entry) => isEditableText(entry.name, entry.size),
  };

  const searchRowActions: SearchRowActions = {
    onEnter: activateSearchResult,
    onDetails: (entry) => setFocusedPath(resultRelPath(entry)),
    onDownload: (entry) =>
      void doDownload(resultRelPath(entry), searchEntryName(entry), entry.size),
    onDelete: (entry) => setDeleteTarget(entryToTarget(entry, '')),
  };

  const quota = quotaQuery.data ?? null;
  const percent = quotaPercent(quota);

  const detailNode = (target: FileOpTarget | null) => {
    if (!target) return null;
    const entry =
      knownEntries.find((e) => entryRowPath(e, dirPath) === target.path) ??
      searchEntries.find((e) => entryRowPath(e, '') === target.path) ??
      null;
    if (!entry) return null;
    const entryPath = entryRowPath(entry, dirPath);
    // 搜索结果的文件可能不在当前目录：详情里的目录上下文取它自己的父目录。
    const entryDir = searchOn && entry.path ? parentDir(entryPath) : dirPath;
    return (
      <aside className="min-h-0 w-full shrink-0 md:w-[380px]" aria-label="文件详情">
        <FileDetailCard
          humanName={humanName}
          entry={entry}
          path={entryPath}
          dirPath={entryDir}
          childCount={loadedChildCount(searchOn ? searchEntries : entries, target.path)}
          canAdmin={canAdmin}
          onClose={() => setFocusedPath(null)}
          onDownload={(e) => void doDownload(entryRowPath(e, dirPath), e.name, e.size)}
          onRename={(e) => setRenameTarget(entryToTarget(e, dirPath))}
          onMove={(e) => setMoveTarget(entryToTarget(e, dirPath))}
          onEdit={(e) => setEditTarget(entryToTarget(e, dirPath))}
          onDelete={(e) => setDeleteTarget(entryToTarget(e, dirPath))}
          onOpenDir={(e) => {
            enterDir(entryRowPath(e, dirPath));
            if (searchOn) clearSearch();
          }}
        />
      </aside>
    );
  };

  const overlayOpen = panes.overlay !== null && Boolean(detailEntry);
  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-col gap-3"
      onClick={(e) => {
        if (isPageBlankClickTarget(e.target)) clearFocusAndSelection();
      }}
    >
      {/* 顶部：人员 + 配额 + 工具条 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            {canAdmin ? (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">人员</span>
                <Select value={humanName} onValueChange={(v) => { setHumanName(v); enterDir(''); }}>
                  <SelectTrigger className="h-11 w-[200px] md:h-9" aria-label="选择人员">
                    <SelectValue placeholder="选择人员" />
                  </SelectTrigger>
                  <SelectContent>
                    {(humans ?? []).map((h) => (
                      <SelectItem key={h.name} value={h.name}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex h-11 items-center gap-2 rounded-md border bg-muted/30 px-3 text-xs md:h-9">
                <Users className="size-3.5" />
                当前用户：{humanName || '未识别'}
                <Badge variant="outline" className="text-xs">只读提示</Badge>
              </div>
            )}
            {quota ? (
              <button
                type="button"
                onClick={() => setQuotaOpen(true)}
                className="flex h-11 min-w-[190px] flex-col justify-center gap-1 rounded-md border px-3 text-left text-xs hover:bg-accent/40 md:h-9"
                aria-label="编辑配额"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">配额</span>
                  <span className="tabular-nums">
                    {formatQuotaValue(quota.usedBytes)} / {formatQuotaValue(quota.quotaBytes)}
                  </span>
                </span>
                <Progress value={percent ?? 0} className="h-1" />
              </button>
            ) : (
              <div className="flex h-11 items-center rounded-md border px-3 text-xs text-muted-foreground md:h-9">
                {quotaQuery.isPending ? '配额加载中…' : '配额不可用'}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onPick(e.target.files)}
              data-testid="files-upload-input"
            />
            <Button className="min-h-11 md:min-h-9" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-4" />
              <span className="hidden sm:inline">上传文件</span>
            </Button>
            <Button
              variant="outline"
              className="min-h-11 md:min-h-9"
              onClick={() => setNewFolderOpen(true)}
              aria-label="新建文件夹"
            >
              <FolderPlus className="size-4" />
              <span className="hidden sm:inline">新建文件夹</span>
            </Button>
            <Button
              variant={multiSelect ? 'secondary' : 'outline'}
              className="min-h-11 md:min-h-9"
              aria-pressed={multiSelect}
              onClick={toggleMultiSelect}
            >
              <List className="size-4" />
              <span className="hidden sm:inline">多选</span>
            </Button>
            <Button
              variant="outline"
              className="min-h-11 md:min-h-9"
              onClick={() => setTrashOpen(true)}
              aria-label={`回收站${trashQuery.data?.length ? `（${trashQuery.data.length}）` : ''}`}
            >
              <Trash className="size-4" />
              <span className="hidden sm:inline">回收站</span>
              {(trashQuery.data?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1 text-xs">
                  {trashQuery.data?.length}
                </Badge>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 md:size-9"
              aria-label="刷新"
              title="刷新当前视图（保留选中与滚动位置）"
              onClick={() => refetchCurrent()}
              disabled={loading || refreshing}
            >
              <RefreshCw className={cn('size-4', (loading || refreshing) && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* 面包屑 + 全局搜索 + 视图切换 + 排序 */}
        <div className="flex flex-wrap items-center gap-2">
          {searchOn ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs" data-testid="files-search-summary">
              <span className="truncate font-medium">搜索结果 · {searchRanked.matched} 项</span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs">
              {crumbs.map((crumb, index) => (
                <span key={crumb.path || 'root'} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
                  <button
                    type="button"
                    onClick={() => enterDir(crumb.path)}
                    className={cn(
                      'min-h-11 max-w-[60vw] cursor-pointer truncate rounded px-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-8',
                      index === crumbs.length - 1 ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
              {targetDir && targetDir !== dirPath && (
                <Badge variant="outline" className="ml-1 text-xs">
                  上传/新建目标：{targetDir}/
                </Badge>
              )}
            </div>
          )}

          {/* 全局搜索（跨目录名称 / 路径）：44px 高；有内容出清除；<2 字符只提示。 */}
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-[280px]">
            <div className="relative min-w-0">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchRaw}
                aria-label="搜索全部文件"
                placeholder="搜索全部文件（名称或路径）"
                onChange={(e) => setSearchRaw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    clearSearch();
                  }
                }}
                className="h-11 w-full min-w-0 rounded-md border bg-background pr-12 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {searchRaw !== '' && (
                <button
                  type="button"
                  aria-label="清除搜索"
                  onClick={clearSearch}
                  className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:size-9"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {searchQuery.tooShort && (
              <span className="text-xs text-muted-foreground">输入至少 2 个字符</span>
            )}
          </div>

          {!searchOn && (
            <>
              <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-[3px]" role="group" aria-label="文件视图">
                {([
                  ['list', List, '列表'],
                  ['tree', FolderOpen, '树'],
                  ['grid', Grid2X2, '网格'],
                ] as const).map(([id, Icon, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={view === id}
                    aria-label={label}
                    onClick={() => {
                      setView(id);
                      setUploadDir('');
                      if (id === 'tree') setRecursive(false);
                    }}
                    className={cn(
                      'flex size-11 cursor-pointer items-center justify-center rounded-md text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:size-9',
                      view === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>

              <select
                aria-label="排序键"
                value={sort.key}
                onChange={(e) => setSort(nextFileSort(sort, e.target.value as FileSort['key']))}
                className="min-h-11 rounded-md border bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-9 sm:min-h-9"
              >
                <option value="name">名称</option>
                <option value="size">大小</option>
                <option value="type">类型</option>
                <option value="updatedAt">修改时间</option>
              </select>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-9"
                onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
                aria-label={sort.dir === 'asc' ? '升序' : '降序'}
              >
                {sort.dir === 'asc' ? '↑' : '↓'}
              </Button>
              {(view === 'list' || view === 'grid') && (
                <Button
                  variant={recursive ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-h-11 sm:min-h-9"
                  aria-pressed={recursive}
                  onClick={() => setRecursive((v) => !v)}
                >
                  全部文件
                </Button>
              )}
            </>
          )}
        </div>

        {/* 端点不可用降级：搜索不生效，当前目录内容照常可见。 */}
        {searchQuery.active && searchUnavailable && (
          <div
            role="alert"
            className="rounded-xl border border-status-waiting/30 bg-status-waiting/5 p-3 text-xs text-status-waiting"
          >
            全局搜索不可用（当前目录内容不受影响）
          </div>
        )}
      </div>

      {backgroundUpdating && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
          data-testid="files-updating-bar"
        >
          <Loader2 className="size-3 animate-spin" />
          正在后台更新…
        </div>
      )}

      {showUploads && uploadItems.length > 0 && (
        <UploadQueuePanel
          items={uploadItems}
          progress={progress}
          onRetry={retryOne}
          onCancel={cancelUpload}
          onDismiss={() => setShowUploads(false)}
        />
      )}

      {/* 批量条：sticky 且留在文档流内（不覆盖最后一行），窄屏贴底留 8px 呼吸 */}
      {multiSelect && selected.size > 0 && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-2 shadow-sm backdrop-blur">
          <span className="text-xs">
            已选 {selectionSummary.count} 项 · {fmtBytes(selectionSummary.bytes)}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={() => void batchDownload()}>
              <Download className="size-3.5" /> 下载
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-destructive sm:min-h-9"
              onClick={() => setBatchDeleteOpen(true)}
            >
              <Trash className="size-3.5" /> 删除
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={clearFocusAndSelection}>
              <X className="size-3.5" /> 取消选择
            </Button>
          </div>
        </div>
      )}

      {/* 主区：列表 + 详情 */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div ref={listRef} className={cn('flex min-h-0 min-w-0 flex-1 flex-col')}>
          {staleErrorText !== '' && !searchOn && (
            <div
              role="alert"
              className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <span className="min-w-0 flex-1">更新失败：{staleErrorText}（屏上是上次结果）</span>
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={() => refetchCurrent()}>
                重试
              </Button>
            </div>
          )}
          {searchOn ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
              <FileSearchResults
                ranked={searchRanked}
                page={searchPage}
                pending={searchPending}
                error={searchErrorText}
                loadingMore={searchData.isFetchingNextPage}
                selectedPath={focusedPath}
                actions={searchRowActions}
                onActivate={activateSearchResult}
                onLoadMore={() => void searchData.fetchNextPage()}
              />
            </div>
          ) : listStatus === '404' ? (
            <div role="alert" className="rounded-xl border border-status-waiting/30 bg-status-waiting/5 p-4 text-sm text-status-waiting">
              无权限或不存在（该文件区不可见）
            </div>
          ) : listStatus === 'err' ? (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <span className="min-w-0 flex-1">{filesErrorText(listError)}</span>
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={() => refetchCurrent()}>
                重试
              </Button>
            </div>
          ) : loading ? (
            <div className="space-y-2 py-3" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 w-full rounded shimmer" />
              ))}
            </div>
          ) : sortedEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <FolderOpen className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-2 text-sm">{recursive ? '文件区还没有文件' : '此目录还是空的'}</p>
              <Button variant="link" className="mt-1 min-h-11" onClick={() => fileInputRef.current?.click()}>
                上传一个文件
              </Button>
            </div>
          ) : (
            <FileDropTarget
              onDrop={(files, truncated) =>
                onDrop(
                  files as unknown as { file: File; relPath: string }[],
                  truncated,
                )
              }
              dropDir={view === 'tree' ? uploadDir || null : null}
            >
              <div
                className="min-h-0 flex-1 overflow-auto"
                onKeyDown={view === 'tree' ? onTreeKeyDown : undefined}
                tabIndex={view === 'tree' ? 0 : undefined}
              >
                {view === 'list' ? (
                  <ListView
                    entries={sortedEntries}
                    dirPath={dirPath}
                    columns={columns}
                    sort={sort}
                    focusedPath={focusedPath}
                    selected={selected}
                    onSort={(key) => setSort((cur) => nextFileSort(cur, key))}
                    onRowClick={onRowClick}
                    onToggleSelect={onToggleSelect}
                    onEnterDir={(entry) => enterDir(entryRowPath(entry, dirPath))}
                    onSelectAll={() =>
                      setSelected((prev) =>
                        selectAllState(prev, visiblePaths) === 'all'
                          ? clearSelection()
                          : new Set(visiblePaths),
                      )
                    }
                    allState={selectAllState(selected, visiblePaths)}
                    actions={entryActions}
                  />
                ) : view === 'tree' ? (
                  <TreeView
                    rows={treeRows}
                    columns={columns}
                    selected={selected}
                    focusedPath={focusedPath}
                    onToggleExpand={(path) => void toggleExpand(path)}
                    onRowClick={onTreeRowClick}
                    onToggleSelect={(row, e) => onToggleSelect(row.entry, e)}
                    actions={entryActions}
                    error={Object.values(treeErrors)[0]}
                  />
                ) : (
                  <GridView
                    humanName={humanName}
                    entries={sortedEntries}
                    dirPath={dirPath}
                    selected={selected}
                    focusedPath={focusedPath}
                    multiSelect={multiSelect}
                    onRowClick={onRowClick}
                    onToggleSelect={onToggleSelect}
                    onEnterDir={(entry) => enterDir(entryRowPath(entry, dirPath))}
                  />
                )}
                {recursive && recursiveQuery.isError && (
                  <div className="flex flex-wrap items-center justify-center gap-2 py-2 text-xs text-destructive">
                    <span>加载更多失败：{filesErrorText(recursiveQuery.error)}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      aria-label="重试加载更多"
                      onClick={() =>
                        void (recursiveQuery.isFetchNextPageError
                          ? recursiveQuery.fetchNextPage()
                          : recursiveQuery.refetch())
                      }
                    >
                      重试
                    </Button>
                  </div>
                )}
                {recursive && recursiveQuery.hasNextPage && (
                  <div className="flex justify-center py-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      disabled={recursiveQuery.isFetchingNextPage}
                      onClick={() => void recursiveQuery.fetchNextPage()}
                    >
                      {recursiveQuery.isFetchingNextPage ? '加载中…' : '加载更多'}
                    </Button>
                  </div>
                )}
              </div>
            </FileDropTarget>
          )}
        </div>

        {panes.detail === 'detail' && detailNode(detailTarget())}
        {panes.detail === 'empty-state' && (
          <div className="hidden w-[380px] shrink-0 md:block" data-testid="files-detail-rail">
            <DetailPlaceholder mode="pick" loading={loading} empty={entries.length === 0} />
          </div>
        )}
      </div>

      {/* drawer / sheet 浮层 */}
      {overlayOpen && detailEntry && (
        <div
          className={cn(
            'fixed inset-0 z-40 flex bg-black/40',
            panes.overlay === 'drawer' ? 'justify-end' : 'items-end',
          )}
          role="dialog"
          aria-modal="true"
          aria-label="文件详情"
        >
          <button
            type="button"
            aria-label="关闭详情"
            className="absolute inset-0 cursor-default"
            onClick={() => setFocusedPath(null)}
          />
          <div
            className={cn(
              'relative z-10 overflow-hidden bg-card shadow-xl',
              panes.overlay === 'drawer'
                ? 'h-full w-[420px] max-w-[92vw]'
                : 'max-h-[85vh] w-full rounded-t-xl',
            )}
          >
            <div className="h-full overflow-y-auto p-2">{detailNode(detailTarget())}</div>
          </div>
        </div>
      )}

      {/* 弹窗 */}
      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        targetDir={targetDir}
        onCreate={onCreateFolder}
      />
      <RenameDialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        target={renameTarget}
        onSubmit={submitRename}
      />
      <MoveDialog
        open={Boolean(moveTarget)}
        onOpenChange={(open) => !open && setMoveTarget(null)}
        target={moveTarget}
        currentDir={dirPath}
        knownDirs={knownDirs}
        onSubmit={submitMove}
      />
      <TextEditorDialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => !open && setEditTarget(null)}
        humanName={humanName}
        target={editTarget}
        onSaved={mutateDone}
      />
      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        target={deleteTarget}
        onConfirm={confirmDelete}
      />
      <DeleteConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        target={null}
        count={selected.size}
        onConfirm={confirmBatchDelete}
      />
      <QuotaDialog
        open={quotaOpen}
        onOpenChange={setQuotaOpen}
        quota={quota}
        canAdmin={canAdmin}
        onSave={async (bytes) => {
          // 乐观写配额条：失败回滚，弹窗按 thrown 显示错误。
          const key = filesQueryKeys.quota(humanName);
          const prev = queryClient.getQueryData<{ usedBytes: number; quotaBytes: number | null }>(key);
          if (prev) queryClient.setQueryData(key, { ...prev, quotaBytes: bytes });
          try {
            await humanFilesApi.setQuota(humanName, bytes);
          } catch (err) {
            if (prev) queryClient.setQueryData(key, prev);
            throw err;
          }
          afterWrite('quota');
        }}
      />
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        entries={(trashQuery.data ?? []) as HumanTrashEntry[]}
        status={trashQuery.isError ? 'err' : ''}
        error={trashQuery.isError ? filesErrorText(trashQuery.error) : ''}
        canAdmin={canAdmin}
        onReload={() => void trashQuery.refetch()}
        onRestore={async (entry, overwrite) => {
          await humanFilesApi.restoreTrash(humanName, entry.id, overwrite);
          // 恢复项落回的目录可能不是当前目录；只失效相关 key，当前目录由刷新校正。
          afterWrite('restore', { dir: parentDir(entry.path) });
        }}
        onPurge={async (entry) => {
          await humanFilesApi.purgeTrash(humanName, entry.id);
          afterWrite('purge');
        }}
      />
    </div>
  );

  function detailTarget(): FileOpTarget | null {
    if (!detailEntry) return null;
    return entryToTarget(detailEntry, dirPath);
  }
}
