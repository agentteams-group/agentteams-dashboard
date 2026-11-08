'use client';

import { useEffect, useState } from 'react';
import {
  Download,
  Eye,
  FolderOpen,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  TEXT_EDIT_MAX_BYTES,
  fileTypeLabel,
  fmtBytes,
  fmtTs,
  isEditableText,
  maskEtag,
} from '@/lib/files-model';
import { humanFilesApi, type HumanFileEntry } from '@/lib/human-files-api';
import { isImageName } from './file-views';

const TEXT_PREVIEW_EXT = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'yaml',
  'yml',
  'csv',
  'tsv',
  'log',
  'xml',
  'sql',
  'ini',
  'conf',
  'toml',
  'html',
  'css',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'go',
  'sh',
]);

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

export function PreviewDialog({
  open,
  onOpenChange,
  humanName,
  entry,
  path,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  humanName: string;
  entry: HumanFileEntry | null;
  path: string;
}) {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });

  useEffect(() => {
    if (!open || !entry) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const run = async () => {
      if (isImageName(entry.name)) {
        setState({ kind: 'loading' });
        try {
          const blob = await humanFilesApi.download(humanName, path, { size: entry.size });
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setState({ kind: 'image', url: objectUrl });
        } catch (err) {
          if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : '预览失败' });
        }
        return;
      }
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
      if (TEXT_PREVIEW_EXT.has(ext) && (entry.size ?? 0) <= TEXT_EDIT_MAX_BYTES) {
        setState({ kind: 'loading' });
        try {
          const r = await humanFilesApi.readText(humanName, path);
          if (!cancelled) setState({ kind: 'text', text: r.text });
        } catch (err) {
          if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : '预览失败' });
        }
        return;
      }
      setState({ kind: 'unsupported' });
    };
    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, entry, humanName, path]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{entry?.name ?? ''}</DialogTitle>
          <DialogDescription>{path}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/20 p-2">
          {state.kind === 'loading' && (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </p>
          )}
          {state.kind === 'image' && (
            <img src={state.url} alt={entry?.name ?? ''} className="mx-auto max-h-[60vh] object-contain" />
          )}
          {state.kind === 'text' && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{state.text}</pre>
          )}
          {state.kind === 'unsupported' && (
            <p className="py-8 text-center text-xs text-muted-foreground" role="status">
              该类型不支持内联预览，请下载查看。
            </p>
          )}
          {state.kind === 'error' && (
            <p role="alert" className="py-8 text-center text-xs text-destructive">
              {state.message}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface FileDetailProps {
  humanName: string;
  entry: HumanFileEntry | null;
  path: string;
  dirPath: string;
  childCount?: number;
  canAdmin: boolean;
  onClose: () => void;
  onDownload: (_entry: HumanFileEntry) => void;
  onRename: (_entry: HumanFileEntry) => void;
  onMove: (_entry: HumanFileEntry) => void;
  onEdit: (_entry: HumanFileEntry) => void;
  onDelete: (_entry: HumanFileEntry) => void;
  onOpenDir: (_entry: HumanFileEntry) => void;
}

/** 文件/目录详情卡（外框圆角 10px、不透明、独立滚动）。 */
export function FileDetailCard({
  humanName,
  entry,
  path,
  dirPath,
  childCount,
  canAdmin,
  onClose,
  onDownload,
  onRename,
  onMove,
  onEdit,
  onDelete,
  onOpenDir,
}: FileDetailProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!entry) return null;
  const isDir = entry.type === 'directory';
  const editable = !isDir && isEditableText(entry.name, entry.size);
  const previewable = !isDir && (isImageName(entry.name) || isEditableText(entry.name, entry.size));

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-xl border bg-card p-3',
      )}
      data-testid="file-detail-card"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={entry.name}>
            {entry.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground" title={path || dirPath}>
            {path || dirPath || '根目录'}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="size-11 shrink-0 sm:size-8" aria-label="关闭详情" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto text-xs">
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-1.5">
          <dt className="text-muted-foreground">类型</dt>
          <dd>{fileTypeLabel(entry)}</dd>
          <dt className="text-muted-foreground">大小</dt>
          <dd>{isDir ? `${childCount ?? 0} 项（已加载）` : fmtBytes(entry.size)}</dd>
          <dt className="text-muted-foreground">修改</dt>
          <dd>{fmtTs(entry.updatedAt) || '—'}</dd>
          <dt className="text-muted-foreground">路径</dt>
          <dd className="break-all font-mono">{path || '/'}</dd>
          {!isDir && (
            <>
              <dt className="text-muted-foreground">ETag</dt>
              <dd className="font-mono">{maskEtag(entry.etag)}</dd>
            </>
          )}
        </dl>
        {!canAdmin && (
          <p className="text-[11px] text-muted-foreground">
            <Badge variant="outline" className="mr-1 text-[10px]">只读提示</Badge>
            无权限的写操作会由服务端拒绝。
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {isDir ? (
          <Button className="col-span-2 h-11" variant="outline" onClick={() => onOpenDir(entry)}>
            <FolderOpen className="size-4" /> 打开文件夹
          </Button>
        ) : (
          <>
            <Button className="h-11" variant="outline" onClick={() => onDownload(entry)}>
              <Download className="size-4" /> 下载
            </Button>
            <Button
              className="h-11"
              variant="outline"
              disabled={!previewable}
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="size-4" /> 预览
            </Button>
          </>
        )}
        <Button className="h-11" variant="outline" onClick={() => onRename(entry)}>
          <Pencil className="size-4" /> 重命名
        </Button>
        <Button className="h-11" variant="outline" onClick={() => onMove(entry)}>
          <FolderOpen className="size-4" /> 移动
        </Button>
        {!isDir && editable && (
          <Button className="col-span-2 h-11" variant="outline" onClick={() => onEdit(entry)}>
            <Pencil className="size-4" /> 在线编辑
          </Button>
        )}
        <Button
          className="col-span-2 h-11 text-destructive"
          variant="outline"
          onClick={() => onDelete(entry)}
        >
          <Trash2 className="size-4" /> 删除
        </Button>
      </div>

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        humanName={humanName}
        entry={entry}
        path={path}
      />
    </div>
  );
}

/** 未选中时的详情栏空态（右栏不得空白）。 */
export function DetailPlaceholder({
  mode,
  loading,
  empty,
}: {
  mode: 'empty-dir' | 'pick' | 'loading';
  loading: boolean;
  empty: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border bg-card p-3 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> 加载中…
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center">
      <FolderOpen className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{empty ? '此目录为空' : '选择一个文件查看详情'}</p>
      <p className="text-xs text-muted-foreground">
        {mode === 'empty-dir'
          ? '使用上方工具条上传文件或新建文件夹'
          : '单击行设为焦点，Ctrl/Shift 或「多选」进入批量选择'}
      </p>
    </div>
  );
}
