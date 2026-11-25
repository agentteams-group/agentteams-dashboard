'use client';

import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  collectDrop,
  dragHasFiles,
  snapshotDrop,
  DROP_MAX_BYTES,
  DROP_MAX_FILES,
  type DataTransferLike,
  type DroppedFile,
} from '@/lib/files-drop';

/** 拖拽上传覆盖层：列表 / 树 / 网格共用；drop → 收集文件（含目录递归）。 */
export function FileDropTarget({
  children,
  onDrop,
  dropDir,
}: {
  children: React.ReactNode;
  onDrop: (_files: DroppedFile[], _truncated: boolean) => void;
  /** 树视图目录行：该目录为上传目标（高亮时不透传区域遮罩）。 */
  dropDir?: string | null;
}) {
  const [active, setActive] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setActive(false);
    const snap = snapshotDrop(e.dataTransfer as unknown as DataTransferLike);
    const result = await collectDrop(snap, { maxFiles: DROP_MAX_FILES, maxBytes: DROP_MAX_BYTES });
    if (result.files.length > 0) onDrop(result.files, result.truncated);
  };

  return (
    <div
      className="relative min-h-0"
      onDragEnter={(e) => {
        if (!dragHasFiles(e.dataTransfer as unknown as DataTransferLike)) return;
        e.preventDefault();
        setActive(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer as unknown as DataTransferLike)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setActive(false);
      }}
      onDrop={(e) => void handleDrop(e)}
      data-drop-dir={dropDir ?? undefined}
    >
      {children}
      {active && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-background/80 text-sm',
          )}
          role="status"
        >
          <UploadCloud className="size-8 text-primary" aria-hidden="true" />
          松开以上传{dropDir ? `到 ${dropDir}/` : '到当前目录'}
        </div>
      )}
    </div>
  );
}
