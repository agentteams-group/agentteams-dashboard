'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  Download,
  FileText,
  Folder,
  History,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  describeHumanFileError,
  formatFileSize,
  formatHumanFileTime,
  humanBreadcrumbs,
  humanFilesApi,
  joinHumanDir,
  type HumanFileEntry,
} from '@/lib/human-files-api';

// Read-only browser for one human's file area: directory listing with
// breadcrumbs, per-file download, and the recycle bin. Uploads, edits, delete
// and restore are deliberately absent — they belong to the plugin/workbench
// surface, not to this admin view.

const TAB_ON = 'bg-background text-foreground shadow-sm';
const TAB_OFF = 'text-muted-foreground hover:text-foreground';

function tabClass(on: boolean): string {
  return cn(
    'h-8 rounded-md px-3 text-xs font-medium transition-colors',
    on ? TAB_ON : TAB_OFF,
  );
}

function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const state = describeHumanFileError(error);
  const Icon = state.kind === 'forbidden' ? ShieldAlert : History;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-2 rounded-lg border p-3 text-xs',
        state.kind === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">{state.message}</span>
      {state.kind === 'error' && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <p className="py-8 text-center text-xs text-muted-foreground" role="status">
      {text}
    </p>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2 py-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-5 w-full rounded shimmer" />
      ))}
    </div>
  );
}

export function HumanFilesPanel({
  humanName,
  active,
}: {
  humanName: string;
  /** False while the dialog shows another tab: keeps every read lazy. */
  active: boolean;
}) {
  const [mode, setMode] = useState<'browse' | 'trash'>('browse');
  const [dir, setDir] = useState('');
  const [recursive, setRecursive] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const dirQuery = useQuery({
    queryKey: ['human-files', humanName, dir],
    queryFn: () => humanFilesApi.listDirectory(humanName, dir),
    enabled: active && mode === 'browse' && !recursive,
    retry: false,
  });

  const recursiveQuery = useInfiniteQuery({
    queryKey: ['human-files-recursive', humanName],
    queryFn: ({ pageParam }) =>
      humanFilesApi.listRecursive(humanName, { cursor: pageParam ?? undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextKey ?? undefined,
    enabled: active && mode === 'browse' && recursive,
    retry: false,
  });

  const trashQuery = useQuery({
    queryKey: ['human-trash', humanName],
    queryFn: () => humanFilesApi.listTrash(humanName),
    enabled: active && mode === 'trash',
    retry: false,
  });

  const browsing = mode === 'browse';
  const busy = browsing
    ? recursive
      ? recursiveQuery.isFetching
      : dirQuery.isFetching
    : trashQuery.isFetching;

  const refresh = () => {
    if (!browsing) void trashQuery.refetch();
    else if (recursive) void recursiveQuery.refetch();
    else void dirQuery.refetch();
  };

  const handleDownload = async (path: string, filename: string) => {
    setDownloading(path);
    try {
      const blob = await humanFilesApi.download(humanName, path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('下载失败', { description: describeHumanFileError(err).message });
    } finally {
      setDownloading(null);
    }
  };

  const crumbs = humanBreadcrumbs(dir);

  const fileRow = (entry: HumanFileEntry, path: string, key: string) => {
    if (entry.type === 'directory') {
      return (
        <li key={key} className="flex min-h-[44px] items-center">
          <button
            type="button"
            onClick={() => setDir(joinHumanDir(dir, entry.name))}
            className="flex min-h-[44px] w-full items-center gap-2 rounded px-1 py-2 text-left hover:bg-accent/50"
          >
            <Folder className="h-4 w-4 shrink-0 text-status-info" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      );
    }
    return (
      <li key={key} className="flex min-h-[44px] items-center gap-2 px-1 py-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm" title={entry.name}>
          {entry.name}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {formatFileSize(entry.size)}
        </span>
        <button
          type="button"
          onClick={() => void handleDownload(path, entry.name.split('/').pop() ?? entry.name)}
          disabled={downloading === path}
          aria-label={`下载 ${entry.name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex items-center gap-1 rounded-lg bg-muted p-[3px]"
          role="group"
          aria-label="文件视图"
        >
          <button
            type="button"
            aria-pressed={browsing}
            onClick={() => setMode('browse')}
            className={tabClass(browsing)}
          >
            文件
          </button>
          <button
            type="button"
            aria-pressed={!browsing}
            onClick={() => setMode('trash')}
            className={tabClass(!browsing)}
          >
            回收站
          </button>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={!active || busy}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', busy && 'animate-spin')} aria-hidden="true" />
          刷新
        </Button>
      </div>

      {browsing && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {recursive ? (
            <span className="px-1.5 py-1 text-muted-foreground">全部文件（按路径平铺）</span>
          ) : (
            crumbs.map((crumb, index) => (
              <span key={crumb.path || 'root'} className="flex items-center gap-1">
                {index > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                )}
                <button
                  type="button"
                  onClick={() => setDir(crumb.path)}
                  className={cn(
                    'rounded px-1.5 py-1 hover:bg-accent',
                    index === crumbs.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {crumb.label}
                </button>
              </span>
            ))
          )}
          <label className="ml-auto flex min-h-[32px] cursor-pointer items-center gap-1.5 text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={recursive}
              onChange={(event) => setRecursive(event.target.checked)}
            />
            全部文件（递归）
          </label>
        </div>
      )}

      {browsing && recursive ? (
        recursiveQuery.isError ? (
          <ErrorBlock error={recursiveQuery.error} onRetry={() => void recursiveQuery.refetch()} />
        ) : recursiveQuery.isPending ? (
          <SkeletonRows />
        ) : (
          <div className="space-y-2">
            {(recursiveQuery.data?.pages ?? []).flatMap((page) => page.entries).length === 0 ? (
              <EmptyBlock text="这个文件区还没有文件" />
            ) : (
              <ul className="divide-y divide-border/50">
                {(recursiveQuery.data?.pages ?? [])
                  .flatMap((page) => page.entries)
                  .map((entry) =>
                    fileRow(
                      { name: entry.path, type: 'file', size: entry.size, updatedAt: entry.updatedAt },
                      entry.path,
                      entry.path,
                    ),
                  )}
              </ul>
            )}
            {recursiveQuery.hasNextPage && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recursiveQuery.isFetchingNextPage}
                  onClick={() => void recursiveQuery.fetchNextPage()}
                >
                  {recursiveQuery.isFetchingNextPage ? '加载中…' : '加载更多'}
                </Button>
              </div>
            )}
          </div>
        )
      ) : browsing ? (
        dirQuery.isError ? (
          <ErrorBlock error={dirQuery.error} onRetry={() => void dirQuery.refetch()} />
        ) : dirQuery.isPending ? (
          <SkeletonRows />
        ) : dirQuery.data.entries.length === 0 ? (
          <EmptyBlock text="这个目录还是空的" />
        ) : (
          <ul className="divide-y divide-border/50">
            {dirQuery.data.entries.map((entry) =>
              fileRow(entry, joinHumanDir(dir, entry.name), entry.name),
            )}
          </ul>
        )
      ) : trashQuery.isError ? (
        <ErrorBlock error={trashQuery.error} onRetry={() => void trashQuery.refetch()} />
      ) : trashQuery.isPending ? (
        <SkeletonRows />
      ) : trashQuery.data.length === 0 ? (
        <EmptyBlock text="回收站是空的" />
      ) : (
        <div className="space-y-2">
          <ul className="divide-y divide-border/50">
            {trashQuery.data.map((entry) => (
              <li key={entry.id} className="flex min-h-[44px] flex-col justify-center gap-0.5 py-2">
                <span className="truncate font-mono text-xs" title={entry.path || '(未知路径)'}>
                  {entry.path || '(未知路径)'}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatFileSize(entry.size)}</span>
                  <span>{formatHumanFileTime(entry.deletedAt)}</span>
                  {entry.caller && <span>删除者 {entry.caller}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-xs">
              只读
            </Badge>
            恢复与彻底删除由插件执行，这里只做查看。
          </p>
        </div>
      )}
    </div>
  );
}
