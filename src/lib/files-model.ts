// 文件管理域纯模型：格式化 / 排序 / 视图 / 列分档 / 选择 / 上传队列 /
// 配额 / 路径校验。全部无 React、无 window 依赖，可直接单测。

import type { HumanFileEntry } from '@/lib/human-files-api';
import { entryDisplayName, entryRelPath, isEntryDir } from '@/lib/human-files-api';

// ── 触控 / 格式化 ──────────────────────────────────────────────────────
export const TOUCH = {
  rowMinHeight: 44,
  btnMinSize: 40,
  btnPadding: 8,
  iconGap: 8,
} as const;

/** 可读大小（B / KB / MB / GB；缺失 → "—"）。 */
export function fmtBytes(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** 可读时间（"YYYY-MM-DD HH:mm"；缺失/非法 → ""）。 */
export function fmtTs(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ERROR_TEXT: Record<number, string> = {
  400: '路径非法',
  403: '无权限',
  404: '无权限或不存在',
  409: '目标路径已存在',
  412: '内容冲突（etag 不匹配）——刷新后重试',
  503: '存储暂不可用，请稍后重试',
};

/** 文件域统一错误 → 文案（403/404/409/412/413/503 统一口径）。 */
export function filesErrorText(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err
      ? Number((err as { status?: unknown }).status) || 0
      : 0;
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  if (status === 413) {
    if (code === 'size_exceeded') return '大小超限（单文件 ≤ 64MiB）';
    if (code === 'quota_exceeded') return '配额已满';
    return '上传失败（大小超限或配额已满）';
  }
  if (status === 503 || code === 'storage_unavailable') {
    return ERROR_TEXT[503];
  }
  if (status && ERROR_TEXT[status]) return ERROR_TEXT[status];
  if (err instanceof Error && err.message) return err.message.replace(/ from .*$/, '');
  return '操作失败';
}

/** 扩展名（小写，无扩展名 → ""）。 */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

/** 类型列：文件夹 / 扩展名大写 / 文件。 */
export function fileTypeLabel(e: HumanFileEntry): string {
  if (isEntryDir(e)) return '文件夹';
  const ext = extOf(entryDisplayName(e));
  return ext ? ext.toUpperCase() : '文件';
}

/** 大小列：目录 → "—"。 */
export function sizeCell(e: HumanFileEntry): string {
  return isEntryDir(e) ? '—' : fmtBytes(e.size);
}

/** ETag 脱敏（展示前 12 位）。 */
export function maskEtag(etag: string | undefined | null): string {
  if (!etag) return '—';
  return etag.length > 12 ? `${etag.slice(0, 12)}…` : etag;
}

// ── 排序 ──────────────────────────────────────────────────────────────
export type FileSortKey = 'name' | 'size' | 'type' | 'updatedAt';
export type SortDir = 'asc' | 'desc';

export interface FileSort {
  key: FileSortKey;
  dir: SortDir;
}

export const FILE_SORT_STORAGE_KEY = 'dashboard.filesSort';
export const DEFAULT_FILE_SORT: FileSort = { key: 'name', dir: 'asc' };

const SORT_KEYS: readonly FileSortKey[] = ['name', 'size', 'type', 'updatedAt'];

export function parseFileSort(raw: unknown): FileSort {
  if (typeof raw !== 'string' || raw === '') return DEFAULT_FILE_SORT;
  try {
    const v = JSON.parse(raw) as { key?: unknown; dir?: unknown };
    const key = SORT_KEYS.includes(v.key as FileSortKey)
      ? (v.key as FileSortKey)
      : DEFAULT_FILE_SORT.key;
    const dir = v.dir === 'desc' ? 'desc' : 'asc';
    return { key, dir };
  } catch {
    return DEFAULT_FILE_SORT;
  }
}

export function serializeFileSort(s: FileSort): string {
  return JSON.stringify({ key: s.key, dir: s.dir });
}

export function nextFileSort(cur: FileSort, key: FileSortKey): FileSort {
  if (cur.key !== key) return { key, dir: 'asc' };
  return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
}

/** 名称比较（numeric + 中文，大小写不敏感）：列表排序与全局搜索同一口径。 */
export function compareEntryName(a: HumanFileEntry, b: HumanFileEntry): number {
  return entryDisplayName(a).localeCompare(entryDisplayName(b), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function parseTime(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function sortValue(e: HumanFileEntry, key: FileSortKey): number | string | null {
  switch (key) {
    case 'size':
      return typeof e.size === 'number' && Number.isFinite(e.size) ? e.size : null;
    case 'type':
      return fileTypeLabel(e);
    case 'updatedAt':
      return parseTime(e.updatedAt);
    case 'name':
    default:
      return entryDisplayName(e);
  }
}

function compareEntry(a: HumanFileEntry, b: HumanFileEntry, sort: FileSort): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const va = sortValue(a, sort.key);
  const vb = sortValue(b, sort.key);
  if (va === null && vb !== null) return 1;
  if (vb === null && va !== null) return -1;
  let cmp = 0;
  if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
  else if (typeof va === 'string' && typeof vb === 'string') {
    cmp =
      sort.key === 'name'
        ? compareEntryName(a, b)
        : va.localeCompare(vb, 'zh-Hans-CN', { sensitivity: 'base' });
  }
  if (cmp === 0) cmp = compareEntryName(a, b);
  return cmp * sign;
}

/** 排序副本：目录恒在前（与方向无关），文件之间再按列比较。 */
export function sortFileEntries(
  entries: readonly HumanFileEntry[],
  sort: FileSort,
): HumanFileEntry[] {
  return [...entries].sort((a, b) => {
    const da = isEntryDir(a);
    const db = isEntryDir(b);
    if (da !== db) return da ? -1 : 1;
    return compareEntry(a, b, sort);
  });
}

/** 树视图逐层排序（根层 + 每个已加载子层）。 */
export function sortTreeLevels(
  roots: readonly HumanFileEntry[],
  children: ReadonlyMap<string, readonly HumanFileEntry[]>,
  sort: FileSort,
): { roots: HumanFileEntry[]; children: Map<string, HumanFileEntry[]> } {
  const out = new Map<string, HumanFileEntry[]>();
  for (const [k, v] of children) out.set(k, sortFileEntries(v, sort));
  return { roots: sortFileEntries(roots, sort), children: out };
}

// ── 三视图 / 树 ────────────────────────────────────────────────────────
export type FilesView = 'list' | 'tree' | 'grid';
export const FILES_VIEW_STORAGE_KEY = 'dashboard.filesView';

export function parseFilesView(raw: unknown): FilesView {
  if (raw === 'tree') return 'tree';
  if (raw === 'grid') return 'grid';
  return 'list';
}

/** 网格最小列数：≤600 → 2；≤900 → 3；≤1400 → 4；否则 5。 */
export function gridMinCols(width: number): number {
  if (width <= 600) return 2;
  if (width <= 900) return 3;
  if (width <= 1400) return 4;
  return 5;
}

/** 传入路径的全部祖先路径（不含自身）。 */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let k = 1; k < parts.length; k += 1) out.push(parts.slice(0, k).join('/'));
  return out;
}

/** 每级缩进：depth*16px。 */
export function treeIndent(depth: number): number {
  return depth < 0 ? 0 : depth * 16;
}

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  expanded: boolean;
  entry: HumanFileEntry;
}

/** 深度优先拍平（父在子前；未展开目录不出子项）。 */
export function flattenTree(opts: {
  roots: readonly HumanFileEntry[];
  children: ReadonlyMap<string, readonly HumanFileEntry[]>;
  expanded: ReadonlySet<string>;
}): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (nodes: readonly HumanFileEntry[], depth: number): void => {
    for (const node of nodes) {
      const p = entryRelPath(node);
      const dir = isEntryDir(node);
      const open = dir && opts.expanded.has(p);
      rows.push({ path: p, name: entryDisplayName(node), depth, isDir: dir, expanded: open, entry: node });
      if (open) {
        const kids = opts.children.get(p);
        if (kids !== undefined) walk(kids, depth + 1);
      }
    }
  };
  walk(opts.roots, 0);
  return rows;
}

/** 树已知条目（根 + 已加载子层；折叠不丢已选）。 */
export function collectTreeEntries(
  roots: readonly HumanFileEntry[],
  children: ReadonlyMap<string, readonly HumanFileEntry[]>,
): HumanFileEntry[] {
  const seen = new Set<HumanFileEntry>();
  const out: HumanFileEntry[] = [];
  const add = (list: readonly HumanFileEntry[]) => {
    for (const e of list) {
      if (seen.has(e)) continue;
      seen.add(e);
      out.push(e);
    }
  };
  add(roots);
  for (const list of children.values()) add(list);
  return out;
}

export type TreeNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter';

export function isTreeNavKey(k: string): k is TreeNavKey {
  return (
    k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Enter'
  );
}

export interface TreeNavRow {
  path: string;
  isDir: boolean;
}

/** 键盘导航 → 新 index；Right/Enter 落在目录上触发 onToggle。 */
export function treeKeyNav(
  state: { rows: readonly TreeNavRow[]; index: number },
  key: TreeNavKey,
  onToggle?: (_path: string) => void,
): number {
  const { rows, index } = state;
  if (key === 'ArrowUp') return index <= 0 ? index : index - 1;
  if (key === 'ArrowDown') return index >= rows.length - 1 ? index : index + 1;
  if (key === 'ArrowRight' || key === 'Enter') {
    const row = rows[index];
    if (row !== undefined && row.isDir) onToggle?.(row.path);
  }
  return index;
}

// ── 列表列分档（按实测列表宽）─────────────────────────────────────────
export type FilesColumn = 'select' | 'name' | 'size' | 'type' | 'modified' | 'actions' | 'more';

export const COLUMN_TRACK: Record<FilesColumn, string> = {
  select: '44px',
  name: 'minmax(0, 1fr)',
  size: '72px',
  type: '84px',
  modified: '120px',
  actions: '152px',
  more: '44px',
};

export const COLUMN_TRACK_PX: Record<FilesColumn, number> = {
  select: 44,
  name: 120,
  size: 72,
  type: 84,
  modified: 120,
  actions: 152,
  more: 44,
};

export const LIST_GAP = 8;

export function listGrid(columns: readonly FilesColumn[]): string {
  return columns.map((c) => COLUMN_TRACK[c]).join(' ');
}

/** 树视图轨道与列表一致：展开箭头在名称单元格内部，不单独占轨道。 */
export function treeGrid(columns: readonly FilesColumn[]): string {
  return listGrid(columns);
}

export function columnsTotal(columns: readonly FilesColumn[]): number {
  const track = columns.reduce((sum, c) => sum + COLUMN_TRACK_PX[c], 0);
  return track + Math.max(0, columns.length - 1) * LIST_GAP;
}

export interface FilesColumns {
  columns: FilesColumn[];
  grid: string;
  total: number;
  compactActions: boolean;
  showUpdatedAt: boolean;
  showSize: boolean;
  showMultiSelect: boolean;
}

/** 列自适应：≥900 全列 / 700–899 收类型·修改 / <700 操作收「更多」。 */
export function columnsFor(listWidth: number, multiSelect: boolean): FilesColumns {
  const w = Number.isFinite(listWidth) && listWidth > 0 ? listWidth : 0;
  const columns: FilesColumn[] = [];
  if (multiSelect) columns.push('select');
  columns.push('name');
  const showSize = w >= 700;
  const showUpdatedAt = w >= 900;
  if (showSize) columns.push('size');
  if (showUpdatedAt) {
    columns.push('type');
    columns.push('modified');
  }
  const compactActions = w < 700;
  columns.push(compactActions ? 'more' : 'actions');
  return {
    columns,
    grid: listGrid(columns),
    total: columnsTotal(columns),
    compactActions,
    showUpdatedAt,
    showSize,
    showMultiSelect: multiSelect,
  };
}

// ── 布局（列表 + 详情）─────────────────────────────────────────────────
export type FilesLayoutMode = 'split' | 'drawer' | 'sheet';

export const SPLIT_MIN_WIDTH = 1024;
export const DETAIL_COL_WIDTH = 380;
export const LIST_MIN_SPLIT_WIDTH = 640;
export const SPLIT_GAP = 12;

export function layoutMode(width: number): FilesLayoutMode {
  if (width >= SPLIT_MIN_WIDTH) return 'split';
  if (width >= 768) return 'drawer';
  return 'sheet';
}

export function estimatedListWidth(containerWidth: number, mode: FilesLayoutMode): number {
  if (mode !== 'split') return containerWidth;
  return Math.max(0, containerWidth - DETAIL_COL_WIDTH - SPLIT_GAP);
}

export function effectiveLayoutMode(o: {
  containerWidth: number;
  listWidth: number;
  listMeasured: boolean;
}): FilesLayoutMode {
  const base = layoutMode(o.containerWidth);
  if (base !== 'split') return base;
  const listW =
    o.listMeasured && o.listWidth > 0 ? o.listWidth : estimatedListWidth(o.containerWidth, base);
  if (listW <= 0) return base;
  return listW < LIST_MIN_SPLIT_WIDTH ? 'drawer' : base;
}

export interface FilesPanes {
  list: 'list';
  detail: 'detail' | 'empty-state' | null;
  overlay: 'drawer' | 'sheet' | null;
}

export function panesFor(mode: FilesLayoutMode, hasSelection: boolean): FilesPanes {
  if (mode === 'split') {
    return { list: 'list', detail: hasSelection ? 'detail' : 'empty-state', overlay: null };
  }
  return { list: 'list', detail: null, overlay: hasSelection ? mode : null };
}

export type FilesDetailState = 'detail' | 'loading' | 'empty-dir' | 'pick';

export function detailState(o: {
  hasSelection: boolean;
  loading: boolean;
  status: '' | '404' | 'err';
  entryCount: number;
}): FilesDetailState {
  if (o.hasSelection) return 'detail';
  if (o.loading) return 'loading';
  if (o.status === '' && o.entryCount === 0) return 'empty-dir';
  return 'pick';
}

// ── 选择 / 焦点 ────────────────────────────────────────────────────────
export type SelectionSet = ReadonlySet<string>;

export function toggleSelection(
  set: SelectionSet,
  path: string,
  opts: { shiftKey?: boolean; anchor?: string | null; paths?: readonly string[] } = {},
): SelectionSet {
  const anchor = opts.shiftKey === true ? (opts.anchor ?? null) : null;
  const ai = anchor != null && opts.paths ? opts.paths.indexOf(anchor) : -1;
  const bi = opts.paths ? opts.paths.indexOf(path) : -1;
  if (opts.shiftKey === true && anchor != null && opts.paths != null && ai >= 0 && bi >= 0) {
    const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
    const next = new Set(set);
    for (let i = lo; i <= hi; i += 1) next.add(opts.paths[i]);
    return next;
  }
  const next = new Set(set);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

export function clickSelection(
  set: SelectionSet,
  path: string,
  opts: { shiftKey?: boolean; toggleKey?: boolean; anchor?: string | null; paths?: readonly string[] } = {},
): { selected: SelectionSet; anchor: string } {
  if (opts.shiftKey === true && opts.anchor != null && opts.paths != null) {
    const ai = opts.paths.indexOf(opts.anchor);
    const bi = opts.paths.indexOf(path);
    if (ai >= 0 && bi >= 0) {
      return {
        selected: toggleSelection(set, path, {
          shiftKey: true,
          anchor: opts.anchor,
          paths: opts.paths,
        }),
        anchor: opts.anchor,
      };
    }
  }
  if (opts.toggleKey === true) {
    return { selected: toggleSelection(set, path), anchor: path };
  }
  return { selected: new Set([path]), anchor: path };
}

export function clearSelection(): SelectionSet {
  return new Set<string>();
}

export function pruneSelection(set: SelectionSet, currentPaths: readonly string[]): SelectionSet {
  const cur = new Set(currentPaths);
  let removed = false;
  const next = new Set<string>();
  for (const p of set) {
    if (cur.has(p)) next.add(p);
    else removed = true;
  }
  return removed ? next : set;
}

export function selectAll(paths: readonly string[]): SelectionSet {
  return new Set(paths);
}

export type SelectAllState = 'all' | 'some' | 'none';

export function selectAllState(set: SelectionSet, paths: readonly string[]): SelectAllState {
  if (paths.length === 0) return 'none';
  let sel = 0;
  for (const p of paths) if (set.has(p)) sel += 1;
  if (sel === 0) return 'none';
  return sel >= paths.length ? 'all' : 'some';
}

export function selectedSummary(
  entries: readonly { path: string; size?: number }[],
  set: SelectionSet,
): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const e of entries) {
    if (set.has(e.path)) {
      count += 1;
      bytes += e.size ?? 0;
    }
  }
  return { count, bytes };
}

export interface RowClickIntent {
  focusOnly: boolean;
  enterMulti: boolean;
  toggle: boolean;
  range: boolean;
}

/** 行点击意图：无修饰且未多选 → 只设焦点。 */
export function rowClickIntent(o: {
  multiSelect: boolean;
  shiftKey: boolean;
  toggleKey: boolean;
}): RowClickIntent {
  const modifier = o.shiftKey || o.toggleKey;
  if (!o.multiSelect && !modifier) {
    return { focusOnly: true, enterMulti: false, toggle: false, range: false };
  }
  return {
    focusOnly: false,
    enterMulti: !o.multiSelect,
    toggle: o.multiSelect ? !o.shiftKey : o.toggleKey,
    range: o.shiftKey,
  };
}

const BLANK_CLICK_SELECTOR =
  '[data-hf-row],button,a,input,select,textarea,[role="checkbox"],[role="menuitem"]';

export function isBlankClickTarget(target: EventTarget | null): boolean {
  const el = target as (Element & { closest?: (_s: string) => Element | null }) | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest(BLANK_CLICK_SELECTOR) === null;
}

export function isPageBlankClickTarget(target: EventTarget | null): boolean {
  if (!isBlankClickTarget(target)) return false;
  const el = target as (Element & { closest?: (_s: string) => Element | null }) | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest('aside') === null;
}

// ── 上传队列 ──────────────────────────────────────────────────────────
export type UploadItemStatus = 'waiting' | 'uploading' | 'success' | 'failed';

export const UPLOAD_CONCURRENCY = 2;

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  path: string;
  status: UploadItemStatus;
  error?: string;
}

export interface UploadProgress {
  total: number;
  finished: number;
  success: number;
  failed: number;
  uploading: number;
  waiting: number;
  percent: number;
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function makeUploadItems(
  files: readonly { name: string; size: number; relPath?: string }[],
  dir: string,
  idPrefix = '',
): UploadItem[] {
  return files.map((f, i) => {
    const rel = f.relPath || f.name;
    return {
      id: `${idPrefix}${i}-${rel}`,
      name: rel.split('/').pop() || f.name,
      size: f.size,
      path: joinPath(dir, rel),
      status: 'waiting' as const,
    };
  });
}

export function startableIds(
  items: readonly UploadItem[],
  limit: number = UPLOAD_CONCURRENCY,
): string[] {
  let running = 0;
  for (const it of items) if (it.status === 'uploading') running += 1;
  const free = limit - running;
  if (free <= 0) return [];
  const out: string[] = [];
  for (const it of items) {
    if (out.length >= free) break;
    if (it.status === 'waiting') out.push(it.id);
  }
  return out;
}

export function markUploadStatus(
  items: readonly UploadItem[],
  id: string,
  status: UploadItemStatus,
  error?: string,
): UploadItem[] {
  let changed = false;
  const next = items.map((it) => {
    if (it.id !== id) return it;
    const err = status === 'failed' ? error : undefined;
    if (it.status === status && it.error === err) return it;
    changed = true;
    return { ...it, status, error: err };
  });
  return changed ? next : (items as UploadItem[]);
}

export function retryUpload(items: readonly UploadItem[], id: string): UploadItem[] {
  let changed = false;
  const next = items.map((it) => {
    if (it.id !== id || it.status !== 'failed') return it;
    changed = true;
    return { ...it, status: 'waiting' as const, error: undefined };
  });
  return changed ? next : (items as UploadItem[]);
}

export function uploadProgress(items: readonly UploadItem[]): UploadProgress {
  let success = 0;
  let failed = 0;
  let uploading = 0;
  let waiting = 0;
  for (const it of items) {
    if (it.status === 'success') success += 1;
    else if (it.status === 'failed') failed += 1;
    else if (it.status === 'uploading') uploading += 1;
    else waiting += 1;
  }
  const total = items.length;
  const finished = success + failed;
  return {
    total,
    finished,
    success,
    failed,
    uploading,
    waiting,
    percent: total === 0 ? 0 : Math.round((finished / total) * 100),
  };
}

// ── 配额（十进制）──────────────────────────────────────────────────────
export type QuotaUnit = 'MB' | 'GB';

export const QUOTA_UNIT_BYTES: Record<QuotaUnit, number> = {
  MB: 1_000_000,
  GB: 1_000_000_000,
};

export interface QuotaForm {
  value: number | null;
  unit: QuotaUnit;
  files: number | null;
}

export interface QuotaView {
  usedBytes: number;
  quotaBytes: number | null;
}

export function quotaFormValid(form: QuotaForm): boolean {
  const capOk = form.value === null || (Number.isFinite(form.value) && form.value >= 0);
  const filesOk =
    form.files === null ||
    (Number.isFinite(form.files) && form.files >= 0 && Number.isInteger(form.files));
  return capOk && filesOk;
}

export function quotaValueToBytes(value: number | null, unit: QuotaUnit = 'MB'): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * QUOTA_UNIT_BYTES[unit]);
}

export function quotaFilesValue(files: number | null): number | null {
  if (files === null || !Number.isFinite(files) || files < 0) return null;
  return Math.floor(files);
}

export function fmtQuotaNumber(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function bytesToQuotaInput(bytes: number | null | undefined): {
  value: number | null;
  unit: QuotaUnit;
} {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return { value: null, unit: 'MB' };
  }
  if (bytes === 0) return { value: 0, unit: 'MB' };
  if (bytes >= QUOTA_UNIT_BYTES.GB) {
    return { value: Math.round((bytes / QUOTA_UNIT_BYTES.GB) * 10) / 10, unit: 'GB' };
  }
  if (bytes >= QUOTA_UNIT_BYTES.MB) {
    return { value: Math.round((bytes / QUOTA_UNIT_BYTES.MB) * 10) / 10, unit: 'MB' };
  }
  return { value: Math.round((bytes / QUOTA_UNIT_BYTES.MB) * 1e6) / 1e6, unit: 'MB' };
}

export function formatQuotaValue(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= QUOTA_UNIT_BYTES.GB) return `${fmtQuotaNumber(bytes / QUOTA_UNIT_BYTES.GB)} GB`;
  if (bytes >= QUOTA_UNIT_BYTES.MB) return `${fmtQuotaNumber(bytes / QUOTA_UNIT_BYTES.MB)} MB`;
  return `${Math.round(bytes)} B`;
}

export function quotaExactText(value: number | null, unit: QuotaUnit): string {
  if (value === null) return '';
  const bytes = quotaValueToBytes(value, unit);
  if (bytes === null) return '';
  return `${fmtQuotaNumber(value)} ${unit} = ${bytes.toLocaleString('en-US')} bytes`;
}

export function quotaToForm(q: QuotaView | null | undefined): QuotaForm {
  if (!q) return { value: null, unit: 'MB', files: null };
  const hit = bytesToQuotaInput(q.quotaBytes);
  return { value: hit.value, unit: hit.unit, files: null };
}

export function quotaFormToPayload(form: QuotaForm): { bytes: number | null; files: number | null } {
  return {
    bytes: quotaValueToBytes(form.value, form.unit),
    files: quotaFilesValue(form.files),
  };
}

/** 配额使用率（0–100；无限制 → null）。 */
export function quotaPercent(q: QuotaView | null | undefined): number | null {
  if (!q || typeof q.quotaBytes !== 'number' || q.quotaBytes <= 0) return null;
  return Math.min(100, Math.round((q.usedBytes / q.quotaBytes) * 100));
}

// ── 路径校验 / 重命名 / 移动 ───────────────────────────────────────────
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export type PathIssue = 'absolute' | 'dotdot' | 'badchar' | 'reserved' | 'empty';

export type ValidPath = { ok: true; path: string } | { ok: false; issue: PathIssue };

export function validateRelPath(raw: string): ValidPath {
  const s = String(raw ?? '').trim();
  if (s.startsWith('/')) return { ok: false, issue: 'absolute' };
  if (s.includes('\\')) return { ok: false, issue: 'badchar' };
  const segs = s.split('/').filter((x) => x !== '');
  if (segs.some((seg) => seg === '.' || seg === '..')) return { ok: false, issue: 'dotdot' };
  if (segs.some((seg) => WINDOWS_RESERVED.test(seg))) return { ok: false, issue: 'reserved' };
  return { ok: true, path: segs.join('/') };
}

export function validateFileName(raw: string): ValidPath {
  const s = String(raw ?? '').trim();
  if (!s || s === '.' || s === '..') return { ok: false, issue: 'empty' };
  if (s.includes('/') || s.includes('\\')) return { ok: false, issue: 'badchar' };
  if (WINDOWS_RESERVED.test(s)) return { ok: false, issue: 'reserved' };
  return { ok: true, path: s };
}

export function joinRelPath(dir: string, name: string): string {
  const a = String(dir ?? '').replace(/^\/+|\/+$/g, '');
  const b = String(name ?? '').replace(/^\/+|\/+$/g, '');
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

export function parentDir(p: string): string {
  const s = String(p ?? '').replace(/^\/+|\/+$/g, '');
  const i = s.lastIndexOf('/');
  return i < 0 ? '' : s.slice(0, i);
}

export function baseName(p: string): string {
  const s = String(p ?? '').replace(/^\/+|\/+$/g, '');
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
}

export function isSubPath(parent: string, child: string): boolean {
  const a = String(parent ?? '').replace(/^\/+|\/+$/g, '');
  const b = String(child ?? '').replace(/^\/+|\/+$/g, '');
  if (!a) return true;
  if (a === b) return true;
  return b.startsWith(`${a}/`);
}

export type MoveIssue = 'invalid_source' | 'invalid_target' | 'into_self' | 'same_dir';

export interface MovePlan {
  from: string;
  to: string;
  name: string;
}

export function movePath(
  source: string,
  targetDir: string,
  opts?: { isDir?: boolean },
): { ok: true; plan: MovePlan } | { ok: false; issue: MoveIssue } {
  const from = validateRelPath(source);
  if (!from.ok || !from.path) return { ok: false, issue: 'invalid_source' };
  const target = validateRelPath(targetDir);
  if (!target.ok) return { ok: false, issue: 'invalid_target' };
  const name = baseName(from.path);
  if (!name) return { ok: false, issue: 'invalid_source' };
  const to = joinRelPath(target.path, name);
  if (to === from.path) return { ok: false, issue: 'same_dir' };
  if (opts?.isDir && isSubPath(from.path, to)) return { ok: false, issue: 'into_self' };
  if (to.startsWith(`${from.path}/`)) return { ok: false, issue: 'into_self' };
  return { ok: true, plan: { from: from.path, to, name } };
}

export type RenameIssue = 'invalid_source' | 'invalid_name' | 'same_name';

export function renamePath(
  source: string,
  newName: string,
): { ok: true; plan: MovePlan } | { ok: false; issue: RenameIssue } {
  const from = validateRelPath(source);
  if (!from.ok || !from.path) return { ok: false, issue: 'invalid_source' };
  const name = validateFileName(newName);
  if (!name.ok) return { ok: false, issue: 'invalid_name' };
  const to = joinRelPath(parentDir(from.path), name.path);
  if (to === from.path) return { ok: false, issue: 'same_name' };
  return { ok: true, plan: { from: from.path, to, name: name.path } };
}

/** 上传目标目录：树选中目录优先，空 = 当前目录。 */
export function resolveTargetDir(uploadDir: string | null | undefined, dirPath: string): string {
  return (uploadDir || dirPath || '').replace(/\/+$/, '');
}

export function targetDirLabel(target: string, rootLabel: string): string {
  const clean = (target || '').replace(/\/+$/, '');
  return clean === '' ? rootLabel : `${clean}/`;
}

// ── 文本编辑 ──────────────────────────────────────────────────────────
export const TEXT_EDIT_MAX_BYTES = 1024 * 1024;

const EDITABLE_EXT = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'yaml',
  'yml',
  'csv',
  'log',
  'tsv',
  'xml',
  'sql',
  'ini',
  'conf',
  'toml',
]);

export function isEditableText(name: string, size?: number): boolean {
  if (typeof size === 'number' && Number.isFinite(size) && size > TEXT_EDIT_MAX_BYTES) return false;
  const ext = extOf(name);
  return ext !== '' && EDITABLE_EXT.has(ext);
}

export function needsUnsavedConfirm(content: string, baseline: string): boolean {
  return content !== baseline;
}

// ── 其它 ──────────────────────────────────────────────────────────────
/** 行键 / 选择键：优先条目自带 path；老形态（只有 name）按当前目录拼。 */
export function entryRowPath(e: HumanFileEntry, dirPath: string): string {
  if (e.path) return e.path.replace(/\/+$/, '');
  return joinRelPath(dirPath, e.name);
}

/** 给老形态条目补全 path（树子层 / 递归平铺统一用）。 */
export function withDirPaths(
  entries: readonly HumanFileEntry[],
  dirPath: string,
): HumanFileEntry[] {
  return entries.map((e) =>
    e.path ? e : { ...e, path: joinRelPath(dirPath, e.name) },
  );
}

/** 目录已加载的直接子项数（只统计已加载条目，不发请求）。 */
export function loadedChildCount(entries: readonly HumanFileEntry[], dirPath: string): number {
  const base = dirPath.replace(/\/+$/, '');
  if (!base) return 0;
  const prefix = `${base}/`;
  let n = 0;
  for (const e of entries) {
    const p = entryRelPath(e).replace(/\/+$/, '');
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (rest.length > 0 && !rest.includes('/')) n += 1;
  }
  return n;
}
