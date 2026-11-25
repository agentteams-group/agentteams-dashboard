'use client';

import { FileIcon } from 'lucide-react';
import type { FileRef } from '@/lib/file-refs';

function formatSize(size?: number): string | null {
  if (size === undefined) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** Chips showing the workspace files referenced by a chat message (#87). */
export function FileRefChips({ refs, className }: { refs: FileRef[]; className?: string }) {
  if (refs.length === 0) return null;
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {refs.map((ref) => {
        const size = formatSize(ref.size);
        return (
          <div
            key={ref.key}
            className="flex w-fit max-w-full items-start gap-2 rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-sm"
            title={ref.key}
          >
            <FileIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="break-all font-medium">{ref.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{[ref.workspace ? `${ref.workspace.kind === 'team' ? '团队' : 'Worker'} · ${ref.workspace.ownerName}` : '工作空间引用', size].filter(Boolean).join(' · ')}</p>
              <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">查看路径</summary><p className="mt-1 break-all font-mono">{ref.key}</p></details>
            </div>
          </div>
        );
      })}
    </div>
  );
}
