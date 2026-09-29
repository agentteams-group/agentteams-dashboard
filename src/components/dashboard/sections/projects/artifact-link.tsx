'use client';

import { useState } from 'react';
import { FolderKanban, CircleAlert, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MarkdownMessage } from '@/components/dashboard/sections/chat/markdown-message';

// ── 产物预览（9/17 验收第六轮：任务看板产物点按=预览，行为对齐产物 tab）────
// 此前 ArtifactLink 点按=直接下载；装验反馈「加上预览」→ 点按开预览对话框
// （md 走 MarkdownMessage、图片 <img>、文本 <pre>，1MB 上限），下载保留为
// 独立图标按钮 + 对话框底部按钮。独立实现避免跨 section 耦合（与
// artifacts-section 的 ArtifactDownloadButton 同款语义约定）。
const ARTIFACT_PREVIEW_MAX_BYTES = 1024 * 1024;
const ARTIFACT_IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]);
function artifactExt(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
interface ArtifactPreviewState {
  status: 'loading' | 'ready' | 'binary' | 'error';
  text?: string;
  error?: string;
  isImage?: boolean;
}

export function ArtifactLink({ href, label }: { href: string; label: string }) {
  const [downloading, setDownloading] = useState(false);
  const [preview, setPreview] = useState<ArtifactPreviewState | null>(null);
  const openPreview = () => {
    setPreview({ status: 'loading' });
    void (async () => {
      try {
        const res = await fetch(href, { cache: 'no-store' });
        if (!res.ok) {
          // 代理透传 controller JSON 错误体——surface 真实原因。
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string; message?: string };
            if (typeof body?.message === 'string' && body.message) detail = body.message;
            else if (typeof body?.error === 'string' && body.error) detail = body.error;
          } catch {
            // non-JSON error body; keep the status
          }
          setPreview({ status: 'error', error: detail });
          return;
        }
        const ctype = res.headers.get('content-type') ?? '';
        if (ctype.startsWith('image/') || ARTIFACT_IMAGE_EXTS.has(artifactExt(label))) {
          setPreview({ status: 'ready', isImage: true });
          return;
        }
        const blob = await res.blob();
        if (blob.size > ARTIFACT_PREVIEW_MAX_BYTES) {
          setPreview({ status: 'binary' });
          return;
        }
        const text = await blob.text();
        if (text.includes('\u0000')) {
          setPreview({ status: 'binary' });
          return;
        }
        setPreview({ status: 'ready', text });
      } catch (err) {
        setPreview({ status: 'error', error: err instanceof Error ? err.message : '预览失败' });
      }
    })();
  };
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(href, { cache: 'no-store' });
      if (!res.ok) {
        // The proxy passes through the controller's JSON error body — surface
        // the real reason instead of letting the browser render it as content.
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (typeof body?.message === 'string' && body.message) detail = body.message;
          else if (typeof body?.error === 'string' && body.error) detail = body.error;
        } catch {
          // non-JSON error body; keep the status
        }
        toast.error('产物下载失败', { description: detail });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = label;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('产物下载失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDownloading(false);
    }
  };
  return (
    <>
      {/* 9/17 装验第 7 轮：下载图标并入产物芯片（一体两键）——独立小按钮
          挨在芯片旁分不清下载的是哪个产物；现在下载键与产物名同框。 */}
      <span className="inline-flex items-center overflow-hidden rounded border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 transition-colors">
        <button
          type="button"
          onClick={openPreview}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] hover:bg-amber-500/15"
          title={`预览：${href}`}
        >
          <FolderKanban className="h-3 w-3" />
          {label}
        </button>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="inline-flex h-[22px] w-5 items-center justify-center border-l border-amber-500/30 hover:bg-amber-500/15 disabled:opacity-50"
          title={`下载：${label}`}
        >
          {downloading ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      </span>
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        {/* 9/17 装验第 7 轮：对话框 90vh 封顶 + 自身可滚——内容再高也不
            超出窗口（此前超高内容把对话框顶破视口）。 */}
        <DialogContent className="sm:max-w-5xl max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate">{label} — 预览</DialogTitle>
            <DialogDescription className="truncate font-mono">{href}</DialogDescription>
          </DialogHeader>
          {/* 双轴滚动：宽内容（代码/表格/长 URL）横向滚而不撑破对话框 */}
          {preview && (
            <div className="max-h-[70vh] min-w-0 overflow-auto rounded-md border bg-muted/20 p-3">
              {preview.status === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  加载中…
                </div>
              )}
              {preview.status === 'error' && (
                <p className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                  <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                  预览失败：{preview.error}
                </p>
              )}
              {preview.status === 'binary' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                  二进制或超过 1MB 的文件不支持内联预览，请用「下载」。
                </p>
              )}
              {preview.status === 'ready' &&
                (preview.isImage ? (
                  <img
                    src={href}
                    alt={label}
                    className="max-w-full max-h-[60vh] rounded-md object-contain"
                  />
                ) : ['md', 'markdown'].includes(artifactExt(label)) ? (
                  <MarkdownMessage content={preview.text ?? ''} formattedContent={undefined} />
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                    {preview.text}
                  </pre>
                ))}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              下载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
