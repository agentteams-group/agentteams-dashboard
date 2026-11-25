'use client';

// 工作区访问规则的「浏览…」目录树（对齐插件 WorkspacePathPicker 的只读版）：
// 根 = 工作区 files/，展开才拉子目录（懒加载），只列目录；点目录即把
// `files/<rel>` 填进当前路径输入行。根目录输出 `files/**`（裸 `files` 不是
// 合法规则路径）。403/404/端点失败 → 提示「目录列表不可用」，手动输入不受影响。

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { humanFilesApi, joinHumanDir } from '@/lib/human-files-api';
import { cn } from '@/lib/utils';

const ROOT = '';

interface DirNode {
  status: 'loading' | 'loaded' | 'error';
  dirs: string[];
}

type DirMap = Record<string, DirNode>;

export interface PickerRow {
  /** 相对 files/ 的目录路径（'' = 根）。 */
  path: string;
  depth: number;
  expanded: boolean;
}

/** 可见行 = 根 + 已展开目录的子项（懒加载：未拉过的子目录也能显示行名）。 */
export function pickerRows(dirs: DirMap, expanded: string[]): PickerRow[] {
  const rows: PickerRow[] = [];
  const walk = (rel: string, depth: number) => {
    const open = expanded.includes(rel);
    rows.push({ path: rel, depth, expanded: open });
    const children = dirs[rel]?.status === 'loaded' ? dirs[rel].dirs : [];
    if (!open) return;
    for (const child of children) walk(child, depth + 1);
  };
  walk(ROOT, 0);
  return rows;
}

/** 目录 → 规则路径：根 = files/**，其余 files/<rel>。 */
export function dirRulePath(rel: string): string {
  return rel ? `files/${rel}` : 'files/**';
}

export function DirectoryPickerDialog({
  open,
  humanName,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  humanName: string;
  onOpenChange: (_open: boolean) => void;
  onPick: (_path: string) => void;
}) {
  const [dirs, setDirs] = useState<DirMap>({});
  const [expanded, setExpanded] = useState<string[]>([ROOT]);
  const [unavailable, setUnavailable] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  // 打开代号：切换人员 / 重新打开时丢弃在途响应。
  const genRef = useRef(0);
  const nodeRefs = useRef<Array<HTMLDivElement | null>>([]);

  const load = useCallback(
    async (rel: string) => {
      const gen = genRef.current;
      setDirs((prev) => ({ ...prev, [rel]: { status: 'loading', dirs: [] } }));
      try {
        const res = await humanFilesApi.listDirectory(humanName, rel);
        if (gen !== genRef.current) return;
        const subdirs = res.entries
          .filter((entry) => entry.type === 'directory')
          .map((entry) => joinHumanDir(rel, entry.name))
          .sort((a, b) => a.localeCompare(b));
        setDirs((prev) => ({ ...prev, [rel]: { status: 'loaded', dirs: subdirs } }));
      } catch {
        if (gen !== genRef.current) return;
        setDirs((prev) => ({ ...prev, [rel]: { status: 'error', dirs: [] } }));
        if (rel === ROOT) setUnavailable(true);
      }
    },
    [humanName],
  );

  useEffect(() => {
    if (!open) return;
    genRef.current += 1;
    setDirs({});
    setExpanded([ROOT]);
    setUnavailable(false);
    setFocusIdx(0);
    nodeRefs.current = [];
    void load(ROOT);
  }, [open, humanName, load]);

  const rows = pickerRows(dirs, expanded);
  const idx = rows.length === 0 ? 0 : Math.min(focusIdx, rows.length - 1);

  const toggle = (rel: string) => {
    setExpanded((prev) => {
      if (prev.includes(rel)) return prev.filter((item) => item !== rel);
      if (dirs[rel] === undefined) void load(rel);
      return [...prev, rel];
    });
  };

  const pick = (rel: string) => {
    onPick(dirRulePath(rel));
    onOpenChange(false);
  };

  const onRowKeyDown = (i: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const row = rows[i];
    if (!row) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0);
        setFocusIdx(next);
        nodeRefs.current[next]?.focus();
        return;
      }
      case 'ArrowRight':
        event.preventDefault();
        if (!row.expanded) toggle(row.path);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.expanded) {
          toggle(row.path);
          return;
        }
        if (row.path) {
          const parent = row.path.split('/').slice(0, -1).join('/');
          const parentIdx = rows.findIndex((item) => item.path === parent);
          if (parentIdx >= 0) {
            setFocusIdx(parentIdx);
            nodeRefs.current[parentIdx]?.focus();
          }
        }
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(row.path);
        return;
      default:
    }
  };

  const label = (rel: string) => (rel ? rel.split('/').pop() || rel : '根目录');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>选择目录</DialogTitle>
          <DialogDescription>
            工作区 files/ 下的目录树；点目录即填入当前路径行（根目录 = files/**，可在输入框继续手改）。
          </DialogDescription>
        </DialogHeader>

        {unavailable ? (
          <div className="space-y-2 py-2">
            <p
              role="alert"
              className="rounded-md border border-status-waiting/30 bg-status-waiting/5 p-2 text-xs text-status-waiting"
            >
              目录列表不可用
            </p>
            <p className="text-xs text-muted-foreground">
              请手动输入路径（例如 files/docs/**）；浏览不可用不影响保存。
            </p>
          </div>
        ) : (
          <div
            role="tree"
            aria-label="工作区目录"
            className="max-h-[52vh] space-y-0.5 overflow-y-auto py-1"
          >
            {rows.map((row, i) => {
              const state = dirs[row.path];
              const loading = state?.status === 'loading';
              const loaded = state?.status === 'loaded';
              const hasChildren = loaded && state.dirs.length > 0;
              return (
                <div
                  key={row.path || '/'}
                  ref={(el) => {
                    nodeRefs.current[i] = el;
                  }}
                  role="treeitem"
                  aria-label={label(row.path)}
                  aria-level={row.depth + 1}
                  aria-expanded={hasChildren || !loaded ? row.expanded : undefined}
                  tabIndex={i === idx ? 0 : -1}
                  data-dir-rel={row.path}
                  className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded px-1.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  style={{ paddingLeft: 6 + row.depth * 16 }}
                  onClick={() => pick(row.path)}
                  onKeyDown={onRowKeyDown(i)}
                  onFocus={() => setFocusIdx(i)}
                >
                  <button
                    type="button"
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={`${row.expanded ? '收起' : '展开'} ${label(row.path)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(row.path);
                    }}
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ChevronRight
                        className={cn('h-3.5 w-3.5 transition-transform', row.expanded && 'rotate-90')}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                  {row.expanded ? (
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 truncate">{label(row.path)}</span>
                  {row.path === ROOT && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">files/</span>
                  )}
                  {state?.status === 'error' && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">不可访问</span>
                  )}
                  {loaded && state.dirs.length === 0 && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">无子目录</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            {unavailable ? '关闭' : '取消'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
