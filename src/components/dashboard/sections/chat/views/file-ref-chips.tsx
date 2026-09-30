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
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {refs.map((ref) => {
        const size = formatSize(ref.size);
        return (
          <span
            key={ref.key}
            className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-border/60 bg-card/70 px-2 py-0.5 text-xs text-muted-foreground"
            title={ref.key}
          >
            <FileIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{ref.name}</span>
            {size && <span className="shrink-0 opacity-70">{size}</span>}
          </span>
        );
      })}
    </div>
  );
}
