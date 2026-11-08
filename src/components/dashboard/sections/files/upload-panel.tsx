'use client';

import { CheckCircle2, Loader2, RotateCcw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { fmtBytes, type UploadItem, type UploadProgress } from '@/lib/files-model';

export function UploadQueuePanel({
  items,
  progress,
  onRetry,
  onCancel,
  onDismiss,
}: {
  items: UploadItem[];
  progress: UploadProgress;
  onRetry: (_id: string) => void;
  onCancel: (_id: string) => void;
  onDismiss: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border bg-card p-3" data-testid="upload-queue">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">
          上传队列 {progress.finished}/{progress.total}
          {progress.failed > 0 && (
            <span className="ml-2 text-destructive">失败 {progress.failed}</span>
          )}
        </p>
        <Button variant="ghost" size="sm" className="h-8" onClick={onDismiss} aria-label="收起上传队列">
          <X className="size-3.5" /> 收起
        </Button>
      </div>
      <Progress value={progress.percent} className="mt-2 h-1.5" aria-label="上传总进度" />
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-9 items-center gap-2 text-xs">
            <span className="shrink-0">
              {item.status === 'success' ? (
                <CheckCircle2 className="size-4 text-emerald-600" aria-label="成功" />
              ) : item.status === 'failed' ? (
                <XCircle className="size-4 text-destructive" aria-label="失败" />
              ) : item.status === 'uploading' ? (
                <Loader2 className="size-4 animate-spin" aria-label="上传中" />
              ) : (
                <span className="block size-4 rounded-full border" aria-label="等待" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={item.path}>
                {item.name}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {fmtBytes(item.size)}
                {item.status === 'failed' && item.error ? ` · ${item.error}` : ''}
              </span>
            </span>
            {item.status === 'failed' ? (
              <Button variant="ghost" size="sm" className="h-8" onClick={() => onRetry(item.id)}>
                <RotateCcw className="size-3.5" /> 重试
              </Button>
            ) : item.status !== 'success' ? (
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-8 text-muted-foreground')}
                onClick={() => onCancel(item.id)}
                aria-label={`取消 ${item.name}`}
              >
                取消
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
