'use client';

import { useEffect, useMemo, useState } from 'react';
import { File as FileIcon, Folder, Loader2, ArrowUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useWorkerFiles, useTeamFiles } from '@/hooks/use-agentteams-storage';
import type { StorageObject } from '@/lib/agentteams-api';
import type { FileRef } from '@/lib/file-refs';

interface FileRefPickerDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  /** Browsing context: a Worker's private space or a team's shared space. */
  kind: 'worker' | 'team';
  /** Worker or team name owning the space (empty disables browsing). */
  ownerName: string;
  onConfirm: (_refs: FileRef[]) => void;
}

function toFileRef(object: StorageObject): FileRef {
  const name = object.key.split('/').filter(Boolean).pop() || object.key;
  return { name, key: object.key, size: object.size };
}

/**
 * Compose the next listing prefix when entering a directory. The worker/team
 * list endpoints return keys relative to the current prefix, so navigation
 * appends rather than replaces (mirrors computeNextPrefix in the files panel).
 */
export function computeRefPrefix(current: string, relativeKey: string): string {
  const cleanRel = relativeKey.endsWith('/') ? relativeKey.slice(0, -1) : relativeKey;
  if (!cleanRel || cleanRel.includes('//')) return current;
  return current ? `${current}${cleanRel}/` : `${cleanRel}/`;
}

/** Parent directory of a listing prefix ('' at the root). */
export function parentRefPrefix(current: string): string {
  const trimmed = current.endsWith('/') ? current.slice(0, -1) : current;
  const parts = trimmed.split('/');
  parts.pop();
  return parts.length > 0 ? `${parts.join('/')}/` : '';
}

export function FileRefPickerDialog({
  open,
  onOpenChange,
  kind,
  ownerName,
  onConfirm,
}: FileRefPickerDialogProps) {
  const [prefix, setPrefix] = useState('');
  // Both hooks run unconditionally (Rules of Hooks); the inactive kind is
  // disabled by an empty owner name.
  const workerQuery = useWorkerFiles(kind === 'worker' && ownerName ? ownerName : '', prefix || undefined);
  const teamQuery = useTeamFiles(kind === 'team' && ownerName ? ownerName : '', prefix || undefined);
  const { data: objects, isLoading } = kind === 'worker' ? workerQuery : teamQuery;

  const [selected, setSelected] = useState<Map<string, FileRef>>(new Map());

  useEffect(() => {
    if (open) {
      setPrefix('');
      setSelected(new Map());
    }
  }, [open]);

  const safeObjects = useMemo(
    () => (objects ?? []).filter((obj) => !obj.key.includes('//')),
    [objects],
  );
  const dirs = safeObjects.filter((o) => o.isPrefix);
  const files = safeObjects.filter((o) => !o.isPrefix);

  const navigateInto = (prefixKey: string) => {
    setPrefix(computeRefPrefix(prefix, prefixKey));
  };

  const navigateUp = () => {
    setPrefix(parentRefPrefix(prefix));
  };

  const toggleFile = (object: StorageObject) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(object.key)) {
        next.delete(object.key);
      } else {
        next.set(object.key, toFileRef(object));
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm([...selected.values()]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="file-ref-picker">
        <DialogHeader>
          <DialogTitle>引用工作空间文件</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {prefix ? (
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={navigateUp}>
              <ArrowUp className="h-3.5 w-3.5 mr-1" />
              返回上级
            </Button>
          ) : (
            <span>{kind === 'worker' ? 'Worker' : 'Team'} 空间根目录</span>
          )}
          <span className="truncate">{prefix || ''}</span>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border border-border/60">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : safeObjects.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {ownerName ? '此目录暂无文件' : '请先选择 Worker 或 Team'}
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {dirs.map((dir) => (
                <li key={dir.key}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => navigateInto(dir.key)}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{dir.key.split('/').filter(Boolean).pop() || dir.key}</span>
                  </button>
                </li>
              ))}
              {files.map((file) => {
                const ref = toFileRef(file);
                const checked = selected.has(file.key);
                return (
                  <li key={file.key}>
                    <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={checked}
                        onChange={() => toggleFile(file)}
                        aria-label={ref.name}
                      />
                      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{ref.name}</span>
                      {ref.size !== undefined && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {ref.size < 1024 * 1024
                            ? `${Math.max(1, Math.round(ref.size / 1024))} KB`
                            : `${(ref.size / 1024 / 1024).toFixed(1)} MB`}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground" data-testid="picker-selected-count">
            已选 {selected.size} 个文件
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={selected.size === 0} onClick={handleConfirm}>
            插入引用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
