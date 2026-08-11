'use client';

import { useCallback, useState } from 'react';
import { Download, FileText, ChevronDown, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import { useMatrixStore } from '@/lib/matrix-store';

interface AttachmentCardProps {
  payload: { url: string; filename: string; mimetype: string };
  /** Optional homeserver override (used to resolve mxc:// to a download URL). */
  homeserver?: string;
}

const TEXT_MIME = /^(text\/|application\/json|application\/xml|application\/x-|image\/svg)/;
const PREVIEW_LIMIT = 256 * 1024;

function friendlyMimeType(mimetype: string): string {
  if (mimetype.startsWith('text/')) return '文本';
  if (mimetype.startsWith('image/')) return '图片';
  if (mimetype.startsWith('application/pdf')) return 'PDF';
  if (mimetype.startsWith('application/json')) return 'JSON';
  if (mimetype.startsWith('application/x-') || mimetype.includes('shell')) return '脚本';
  if (mimetype.startsWith('application/zip') || mimetype.includes('archive')) return '压缩包';
  return mimetype || '附件';
}

export function AttachmentCard({ payload, homeserver }: AttachmentCardProps) {
  const { homeserver: storeHomeserver } = useMatrixStore();
  const base = homeserver || storeHomeserver;
  const downloadUrl = mxcToDownloadUrl(payload.url, base);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canPreview = TEXT_MIME.test(payload.mimetype);

  const loadPreview = useCallback(async () => {
    if (!downloadUrl) return;
    setLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setPreview(text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…（内容已截断）` : text);
    } catch {
      setPreviewError('预览加载失败');
    } finally {
      setLoading(false);
    }
  }, [downloadUrl]);

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-muted/30 overflow-hidden max-w-full">
      <div className="flex items-center gap-2 px-3 py-2">
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{payload.filename}</p>
          <p className="text-[10px] text-muted-foreground">{friendlyMimeType(payload.mimetype)} · 全文附件</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canPreview && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                const next = !open;
                setOpen(next);
                if (next && !preview && !previewError) loadPreview();
              }}
            >
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {open ? '收起' : '预览'}
            </Button>
          )}
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline px-2 h-7"
              title="下载全文"
            >
              <Download className="w-3.5 h-3.5" />
              下载
            </a>
          )}
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3 border-t border-border/30">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              加载预览...
            </div>
          ) : previewError ? (
            <div className="flex items-center gap-2 text-xs text-red-500 py-2">
              <AlertTriangle className="w-3 h-3" />
              {previewError}
            </div>
          ) : preview ? (
            <pre className="mt-2 text-xs whitespace-pre-wrap break-all font-mono text-muted-foreground max-h-96 overflow-y-auto">
              {preview}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}
