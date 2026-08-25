'use client';

import { Upload } from 'lucide-react';

/**
 * Full-room overlay shown while a file drag is in progress. Purely visual —
 * the drop logic lives in `useFileDropZone`.
 */
export interface DragDropOverlayProps {
  active: boolean;
  /** Primary label, e.g. "松开以上传文件". */
  label?: string;
  /** Secondary caption, e.g. "支持多文件，发送到 team-alpha". */
  description?: string;
}

export function DragDropOverlay({
  active,
  label = '拖入文件以上传',
  description,
}: DragDropOverlayProps) {
  if (!active) return null;
  return (
    <div
      data-testid="chat-drop-overlay"
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary/60 bg-background/80 px-8 py-6 text-foreground shadow-lg">
        <Upload className="h-8 w-8 text-primary" aria-hidden />
        <span className="text-base font-medium">{label}</span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </div>
    </div>
  );
}