'use client';

import { useMemo, useState } from 'react';
import { ArchiveRestore, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { filesErrorText, fmtBytes, fmtTs } from '@/lib/files-model';
import type { HumanTrashEntry } from '@/lib/human-files-api';

type SortKey = 'deletedAt' | 'size' | 'name';

export function TrashDialog({
  open,
  onOpenChange,
  entries,
  status,
  error,
  canAdmin,
  onReload,
  onRestore,
  onPurge,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  entries: HumanTrashEntry[];
  status: '' | 'err';
  error: string;
  canAdmin: boolean;
  onReload: () => void;
  onRestore: (_entry: HumanTrashEntry, _overwrite: boolean) => Promise<void>;
  onPurge: (_entry: HumanTrashEntry) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('deletedAt');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [confirmRestoreAll, setConfirmRestoreAll] = useState(false);
  const [conflict, setConflict] = useState<{ entry: HumanTrashEntry; message: string } | null>(null);
  const [notice, setNotice] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            (e.caller ?? '').toLowerCase().includes(q),
        )
      : entries;
    return [...filtered].sort((a, b) => {
      if (sort === 'size') return b.size - a.size;
      if (sort === 'name') return a.path.localeCompare(b.path, 'zh-Hans-CN', { numeric: true });
      return (b.deletedAt || b.id).localeCompare(a.deletedAt || a.id);
    });
  }, [entries, query, sort]);

  const restoreOne = async (entry: HumanTrashEntry, overwrite: boolean) => {
    setBusyId(entry.id);
    setNotice('');
    try {
      await onRestore(entry, overwrite);
      setConflict(null);
    } catch (err) {
      const statusOf =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : 0;
      if (statusOf === 409) {
        setConflict({ entry, message: '目标路径已存在' });
      } else {
        setNotice(filesErrorText(err));
      }
    } finally {
      setBusyId(null);
    }
  };

  const restoreAll = async () => {
    setConfirmRestoreAll(false);
    setBusyId('*');
    let ok = 0;
    let failed = 0;
    for (const e of rows) {
      try {
        await onRestore(e, false);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBusyId(null);
    setNotice(`恢复完成：成功 ${ok} 项${failed > 0 ? `，失败 ${failed} 项` : ''}`);
  };

  const purgeOne = async (entry: HumanTrashEntry) => {
    setConfirmPurge(null);
    setBusyId(entry.id);
    try {
      await onPurge(entry);
    } catch (err) {
      setNotice(filesErrorText(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>回收站</DialogTitle>
          <DialogDescription>
            共 {entries.length} 项 · 恢复后回到原路径
            {!canAdmin && ' · 彻底删除仅管理员可用'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索回收站"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按原路径 / 操作人搜索"
              className="h-9 pl-8"
            />
          </div>
          <select
            aria-label="回收站排序"
            value={sort}
            onChange={(e) =>
              setSort(e.target.value === 'size' ? 'size' : e.target.value === 'name' ? 'name' : 'deletedAt')
            }
            className="min-h-11 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-9 sm:min-h-9"
          >
            <option value="deletedAt">删除时间</option>
            <option value="size">大小</option>
            <option value="name">名称</option>
          </select>
          <Button variant="ghost" size="sm" className="h-9" onClick={onReload} disabled={busyId !== null}>
            <RefreshCw className={cn('size-3.5', busyId === '*' && 'animate-spin')} />
            刷新
          </Button>
          {rows.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busyId !== null}
              onClick={() => setConfirmRestoreAll(true)}
            >
              <ArchiveRestore className="size-3.5" />
              全部恢复
            </Button>
          )}
        </div>

        {confirmRestoreAll && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-waiting/40 bg-status-waiting/10 p-2 text-xs">
            <span className="min-w-0 flex-1">确认恢复全部 {rows.length} 项？同名冲突会逐条失败。</span>
            <Button size="sm" variant="outline" onClick={() => setConfirmRestoreAll(false)}>
              取消
            </Button>
            <Button size="sm" onClick={() => void restoreAll()}>
              确认恢复
            </Button>
          </div>
        )}

        {conflict && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-status-waiting/40 bg-status-waiting/10 p-2 text-xs">
            <span className="min-w-0 flex-1">
              {conflict.entry.path}：{conflict.message}
            </span>
            {canAdmin ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setConflict(null)}>
                  取消
                </Button>
                <Button size="sm" onClick={() => void restoreOne(conflict.entry, true)}>
                  覆盖恢复
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConflict(null)}>
                知道了
              </Button>
            )}
          </div>
        )}

        {notice && (
          <p role="status" className="rounded-md border bg-muted/40 p-2 text-xs">
            {notice}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {status === 'err' ? (
            <div role="alert" className="flex items-center gap-2 p-3 text-xs text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              <Button variant="ghost" size="sm" onClick={onReload}>
                重试
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground" role="status">
              {query ? '没有匹配的回收站条目' : '回收站是空的'}
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((entry) => (
                <li key={entry.id} className="flex min-h-[56px] flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs" title={entry.path || '(未知路径)'}>
                      {entry.path || '(未知路径)'}
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{fmtBytes(entry.size)}</span>
                      <span>{fmtTs(entry.deletedAt) || '—'}</span>
                      {entry.caller && <span>删除者 {entry.caller}</span>}
                      {entry.role && <Badge variant="outline" className="text-[10px]">{entry.role}</Badge>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    disabled={busyId !== null}
                    onClick={() => void restoreOne(entry, false)}
                    aria-label={`恢复 ${entry.path}`}
                  >
                    {busyId === entry.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArchiveRestore className="size-3.5" />
                    )}
                    恢复
                  </Button>
                  {confirmPurge === entry.id ? (
                    <>
                      <Button size="sm" variant="ghost" className="h-9" onClick={() => setConfirmPurge(null)}>
                        取消
                      </Button>
                      <Button size="sm" variant="destructive" className="h-9" onClick={() => void purgeOne(entry)}>
                        彻底删除
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-destructive"
                      disabled={!canAdmin || busyId !== null}
                      title={canAdmin ? '彻底删除（不可恢复）' : '仅管理员'}
                      onClick={() => setConfirmPurge(entry.id)}
                      aria-label={`彻底删除 ${entry.path}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
