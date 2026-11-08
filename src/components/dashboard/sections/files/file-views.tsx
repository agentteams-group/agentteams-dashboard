'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Info,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  entryRowPath,
  extOf,
  fileTypeLabel,
  fmtTs,
  sizeCell,
  treeGrid,
  type FilesColumns,
  type FileSort,
  type FileSortKey,
  type TreeRow,
} from '@/lib/files-model';
import { humanFilesApi, type HumanFileEntry } from '@/lib/human-files-api';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']);

export function isImageName(name: string): boolean {
  return IMAGE_EXT.has(extOf(name));
}

export function FileGlyph({ entry, className }: { entry: HumanFileEntry; className?: string }) {
  const ext = extOf(entry.name);
  const Icon =
    entry.type === 'directory'
      ? Folder
      : IMAGE_EXT.has(ext)
        ? ImageIcon
        : ARCHIVE_EXT.has(ext)
          ? FileArchive
          : FileText;
  return (
    <Icon
      className={cn(
        'size-4 shrink-0',
        entry.type === 'directory' ? 'text-status-info' : 'text-muted-foreground',
        className,
      )}
      aria-hidden="true"
    />
  );
}

export interface EntryActions {
  onDetails: (_entry: HumanFileEntry) => void;
  onDownload: (_entry: HumanFileEntry) => void;
  onRename: (_entry: HumanFileEntry) => void;
  onMove: (_entry: HumanFileEntry) => void;
  onEdit: (_entry: HumanFileEntry) => void;
  onDelete: (_entry: HumanFileEntry) => void;
  editable: (_entry: HumanFileEntry) => boolean;
}

function ActionsMenu({ entry, actions }: { entry: HumanFileEntry; actions: EntryActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 sm:size-9"
          aria-label={`更多操作 ${entry.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => actions.onDetails(entry)}>
          <Info className="size-4" /> 详情
        </DropdownMenuItem>
        {entry.type === 'file' && (
          <DropdownMenuItem onSelect={() => actions.onDownload(entry)}>
            <Download className="size-4" /> 下载
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.onRename(entry)}>
          <Pencil className="size-4" /> 重命名
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onMove(entry)}>
          <FolderOpen className="size-4" /> 移动
        </DropdownMenuItem>
        {entry.type === 'file' && actions.editable(entry) && (
          <DropdownMenuItem onSelect={() => actions.onEdit(entry)}>
            <FileText className="size-4" /> 编辑
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => actions.onDelete(entry)}
        >
          <Trash2 className="size-4" /> 删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortIcon({ sort, column }: { sort: FileSort; column: FileSortKey }) {
  if (sort.key !== column) return null;
  return sort.dir === 'asc' ? (
    <ArrowUp className="size-3" aria-hidden="true" />
  ) : (
    <ArrowDown className="size-3" aria-hidden="true" />
  );
}

function HeaderCell({
  column,
  label,
  sort,
  onSort,
  className,
}: {
  column: FileSortKey;
  label: string;
  sort: FileSort;
  onSort: (_key: FileSortKey) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn('flex min-h-11 cursor-pointer items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-8', className)}
      aria-label={`按${label}排序`}
    >
      {label}
      <SortIcon sort={sort} column={column} />
    </button>
  );
}

export interface ListViewProps {
  entries: HumanFileEntry[];
  dirPath: string;
  columns: FilesColumns;
  sort: FileSort;
  focusedPath: string | null;
  selected: ReadonlySet<string>;
  onSort: (_key: FileSortKey) => void;
  onRowClick: (_entry: HumanFileEntry, _e: React.MouseEvent) => void;
  onToggleSelect: (_entry: HumanFileEntry, _e: React.MouseEvent) => void;
  onEnterDir: (_entry: HumanFileEntry) => void;
  onSelectAll: () => void;
  allState: 'all' | 'some' | 'none';
  actions: EntryActions;
}

export function ListView({
  entries,
  dirPath,
  columns,
  sort,
  focusedPath,
  selected,
  onSort,
  onRowClick,
  onToggleSelect,
  onEnterDir,
  onSelectAll,
  allState,
  actions,
}: ListViewProps) {
  const grid = columns.grid;
  return (
    <div className="min-w-0">
      <div
        role="row"
        className="grid items-center gap-2 border-b px-2 pb-1"
        style={{ gridTemplateColumns: grid }}
        data-testid="files-list-header"
      >
        {columns.showMultiSelect && (
          <label className="flex size-11 items-center justify-center">
            <input
              type="checkbox"
              aria-label="全选"
              className="size-4 accent-primary"
              checked={allState === 'all'}
              ref={(el) => {
                if (el) el.indeterminate = allState === 'some';
              }}
              onChange={onSelectAll}
            />
          </label>
        )}
        <HeaderCell column="name" label="名称" sort={sort} onSort={onSort} />
        {columns.showSize && <HeaderCell column="size" label="大小" sort={sort} onSort={onSort} />}
        {columns.showUpdatedAt && (
          <>
            <HeaderCell column="type" label="类型" sort={sort} onSort={onSort} />
            <HeaderCell column="updatedAt" label="修改时间" sort={sort} onSort={onSort} />
          </>
        )}
        <span className="text-right text-xs text-muted-foreground">操作</span>
      </div>

      <ul className="divide-y divide-border/50" role="list">
        {entries.map((entry) => {
          const path = entryRowPath(entry, dirPath);
          const isDir = entry.type === 'directory';
          const focused = focusedPath === path;
          const checked = selected.has(path);
          const showSecondary = !columns.showSize || !columns.showUpdatedAt;
          return (
            <li key={path}>
              <div
                data-hf-row
                data-path={path}
                role="button"
                tabIndex={0}
                aria-label={entry.name}
                aria-current={focused ? 'true' : undefined}
                onClick={(e) => onRowClick(entry, e)}
                onDoubleClick={() => isDir && onEnterDir(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (isDir) onEnterDir(entry);
                    else onRowClick(entry, e as unknown as React.MouseEvent);
                  }
                }}
                className={cn(
                  'grid min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  focused ? 'bg-primary/10' : 'hover:bg-accent/40',
                )}
                style={{ gridTemplateColumns: grid }}
              >
                {columns.showMultiSelect && (
                  <label
                    className="flex size-11 items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择 ${entry.name}`}
                      className="size-4 accent-primary"
                      checked={checked}
                      onChange={(e) => onToggleSelect(entry, e as unknown as React.MouseEvent)}
                    />
                  </label>
                )}
                <div className="flex min-w-0 items-center gap-2">
                  <FileGlyph entry={entry} />
                  <div className="min-w-0">
                    <p className="truncate" title={entry.name}>
                      {entry.name}
                    </p>
                    {showSecondary && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {sizeCell(entry)}
                        {fmtTs(entry.updatedAt) ? ` · ${fmtTs(entry.updatedAt)}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                {columns.showSize && (
                  <span className="truncate text-xs text-muted-foreground">{sizeCell(entry)}</span>
                )}
                {columns.showUpdatedAt && (
                  <>
                    <span className="truncate text-xs text-muted-foreground">{fileTypeLabel(entry)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {fmtTs(entry.updatedAt) || '—'}
                    </span>
                  </>
                )}
                <div className="flex items-center justify-end gap-2">
                  {columns.compactActions ? (
                    <ActionsMenu entry={entry} actions={actions} />
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        aria-label={`详情 ${entry.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.onDetails(entry);
                        }}
                      >
                        <Info className="size-4" />
                      </Button>
                      {!isDir && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 sm:size-9"
                          aria-label={`下载 ${entry.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.onDownload(entry);
                          }}
                        >
                          <Download className="size-4" />
                        </Button>
                      )}
                      <ActionsMenu entry={entry} actions={actions} />
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface TreeViewProps {
  rows: TreeRow[];
  columns: FilesColumns;
  selected: ReadonlySet<string>;
  focusedPath: string | null;
  onToggleExpand: (_path: string) => void;
  onRowClick: (_row: TreeRow, _e: React.MouseEvent) => void;
  onToggleSelect: (_row: TreeRow, _e: React.MouseEvent) => void;
  actions: EntryActions;
  error?: string;
}

export function TreeView({
  rows,
  columns,
  selected,
  focusedPath,
  onToggleExpand,
  onRowClick,
  onToggleSelect,
  actions,
  error,
}: TreeViewProps) {
  const grid = treeGrid(columns.columns);
  return (
    <div className="min-w-0">
      <div
        className="grid items-center gap-2 border-b px-2 pb-1 text-xs text-muted-foreground"
        style={{ gridTemplateColumns: grid }}
        data-testid="files-tree-header"
      >
        {columns.showMultiSelect && <span className="size-11" />}
        <span>名称</span>
        {columns.showSize && <span>大小</span>}
        {columns.showUpdatedAt && (
          <>
            <span>类型</span>
            <span>修改时间</span>
          </>
        )}
        <span className="text-right">操作</span>
      </div>
      {error && (
        <p role="alert" className="p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <ul role="tree" aria-label="文件树" className="divide-y divide-border/40">
        {rows.map((row, index) => {
          const checked = selected.has(row.path);
          const focused = focusedPath === row.path;
          return (
            <li key={row.path} role="treeitem" aria-selected={checked} aria-expanded={row.isDir ? row.expanded : undefined}>
              <div
                data-hf-row
                data-tree-index={index}
                data-path={row.path}
                className={cn(
                  'grid min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  focused ? 'bg-primary/10' : 'hover:bg-accent/40',
                )}
                style={{ gridTemplateColumns: grid }}
                onClick={(e) => onRowClick(row, e)}
                onDoubleClick={() => row.isDir && onToggleExpand(row.path)}
              >
                {columns.showMultiSelect && (
                  <label className="flex size-11 items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${row.name}`}
                      className="size-4 accent-primary"
                      checked={checked}
                      onChange={(e) => onToggleSelect(row, e as unknown as React.MouseEvent)}
                    />
                  </label>
                )}
                <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: row.depth * 16 }}>
                  {row.isDir ? (
                    // 24px 视觉 + after 伪元素把命中区扩到 44×44（不撑动树缩进）
                    <button
                      type="button"
                      className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent after:absolute after:-inset-2.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      aria-label={row.expanded ? `收起 ${row.name}` : `展开 ${row.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(row.path);
                      }}
                    >
                      <ChevronRight
                        className={cn('size-3.5 transition-transform', row.expanded && 'rotate-90')}
                      />
                    </button>
                  ) : (
                    <span className="size-6 shrink-0" />
                  )}
                  <FileGlyph entry={row.entry} />
                  <span className="truncate" title={row.path}>
                    {row.name}
                  </span>
                </div>
                {columns.showSize && (
                  <span className="text-xs text-muted-foreground">{sizeCell(row.entry)}</span>
                )}
                {columns.showUpdatedAt && (
                  <>
                    <span className="text-xs text-muted-foreground">{fileTypeLabel(row.entry)}</span>
                    <span className="text-xs text-muted-foreground">{fmtTs(row.entry.updatedAt) || '—'}</span>
                  </>
                )}
                <div className="flex items-center justify-end gap-2">
                  {columns.compactActions ? (
                    <ActionsMenu entry={row.entry} actions={actions} />
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        aria-label={`详情 ${row.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.onDetails(row.entry);
                        }}
                      >
                        <Info className="size-4" />
                      </Button>
                      <ActionsMenu entry={row.entry} actions={actions} />
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Thumb({ humanName, entry }: { humanName: string; entry: HumanFileEntry }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isImageName(entry.name)) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    let started = false;

    const load = async () => {
      if (started) return;
      started = true;
      try {
        const blob = await humanFilesApi.download(humanName, entry.path ?? entry.name, { size: entry.size });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        /* 缩略图失败 → 图标兜底 */
      }
    };

    const el = ref.current;
    if (el && typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void load();
        }
      });
      io.observe(el);
      return () => {
        cancelled = true;
        io.disconnect();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [humanName, entry.name, entry.path, entry.size]);

  return (
    <div ref={ref} className="flex h-20 w-full items-center justify-center overflow-hidden rounded-md bg-muted/40">
      {url ? (
        <img src={url} alt={entry.name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <FileGlyph entry={entry} className="size-7" />
      )}
    </div>
  );
}

export interface GridViewProps {
  humanName: string;
  entries: HumanFileEntry[];
  dirPath: string;
  selected: ReadonlySet<string>;
  focusedPath: string | null;
  multiSelect: boolean;
  onRowClick: (_entry: HumanFileEntry, _e: React.MouseEvent) => void;
  onToggleSelect: (_entry: HumanFileEntry, _e: React.MouseEvent) => void;
  onEnterDir: (_entry: HumanFileEntry) => void;
}

export function GridView({
  humanName,
  entries,
  dirPath,
  selected,
  focusedPath,
  multiSelect,
  onRowClick,
  onToggleSelect,
  onEnterDir,
}: GridViewProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
      {entries.map((entry) => {
        const path = entryRowPath(entry, dirPath);
        const focused = focusedPath === path;
        return (
          <div
            key={path}
            data-hf-row
            data-path={path}
            role="button"
            tabIndex={0}
            aria-label={entry.name}
            onClick={(e) => onRowClick(entry, e)}
            onDoubleClick={() => entry.type === 'directory' && onEnterDir(entry)}
            className={cn(
              'relative flex min-h-[132px] cursor-pointer flex-col gap-2 rounded-xl border bg-card p-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              focused ? 'border-primary/60 bg-primary/5' : 'hover:bg-accent/30',
            )}
          >
            {multiSelect && (
              <label className="absolute right-0 top-0 z-10 flex size-11 items-center justify-center">
                <input
                  type="checkbox"
                  aria-label={`选择 ${entry.name}`}
                  className="size-4 accent-primary"
                  checked={selected.has(path)}
                  onChange={(e) => onToggleSelect(entry, e as unknown as React.MouseEvent)}
                  onClick={(e) => e.stopPropagation()}
                />
              </label>
            )}
            {isImageName(entry.name) && entry.type === 'file' ? (
              <Thumb humanName={humanName} entry={entry} />
            ) : (
              <div className="flex h-20 items-center justify-center rounded-md bg-muted/40">
                <FileGlyph entry={entry} className="size-7" />
              </div>
            )}
            <div className="min-w-0">
              <p className="line-clamp-2 break-words text-xs leading-4" title={entry.name}>
                {entry.name}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{sizeCell(entry)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
