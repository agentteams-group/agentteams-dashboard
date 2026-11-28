'use client';

import { createContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { HtmlPreview } from '@/components/dashboard/html-preview';
import { useMatrixStore } from '@/lib/matrix-store';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import { DocumentPreview } from '@/components/dashboard/document-preview';
import { isSlideDocument } from '@/lib/document-preview';
import { markdownUrl } from '@/lib/markdown-url';

export interface PreviewAttachment {
  filename: string;
  url: string;
  mimetype: string;
  homeserver: string;
}

export const AttachmentPreviewContext = createContext<((_file: PreviewAttachment) => void) | null>(null);

const PREVIEW_LIMIT = 512 * 1024;
export function attachmentPreviewKind(file: Pick<PreviewAttachment, 'filename' | 'mimetype'>) {
  if (isSlideDocument(file.filename) || /^application\/(?:pdf|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation)\b/i.test(file.mimetype)) return 'document';
  if (/\.html?$/i.test(file.filename) || /^text\/html\b/i.test(file.mimetype)) return 'html';
  if (/\.(?:md|markdown)$/i.test(file.filename) || /^text\/markdown\b/i.test(file.mimetype)) return 'markdown';
  if (/^(?:text\/|application\/(?:json|xml)\b)/i.test(file.mimetype) || /\.(?:txt|json|xml|csv|log)$/i.test(file.filename)) return 'text';
  return null;
}

function PreviewContent({ file }: { file: PreviewAttachment }) {
  const { accessToken, userId } = useMatrixStore();
  const url = mxcToDownloadUrl(file.url, file.homeserver);
  const kind = attachmentPreviewKind(file);
  const query = useQuery({
    queryKey: ['chat-attachment-preview', userId, url],
    queryFn: async ({ signal }) => {
      const response = await fetch(url!, {
        signal,
        headers: file.url.startsWith('mxc://') && accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!response.ok) throw new Error('预览加载失败');
      // Read only the preview window, even when the response omits Content-Length.
      const reader = response.body?.getReader();
      if (!reader) return { text: '', truncated: false };
      const decoder = new TextDecoder();
      let text = '';
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return { text: text + decoder.decode(), truncated: false };
          const remaining = PREVIEW_LIMIT - size;
          if (value.length > remaining) {
            return { text: text + decoder.decode(value.subarray(0, remaining)), truncated: true };
          }
          size += value.length;
          text += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    },
    enabled: !!url && !!kind && kind !== 'document',
    retry: false,
    staleTime: 60_000,
    throwOnError: false,
  });

  if (kind === 'document' && url) return <DocumentPreview url={url} filename={file.filename} mimetype={file.mimetype} accessToken={file.url.startsWith('mxc://') ? accessToken : undefined} />;
  if (query.isPending) return <div role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载预览…</div>;
  if (query.isError) return <div role="alert" className="p-4 text-sm text-destructive">预览加载失败 <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>重试</Button></div>;
  if (kind === 'html' && query.data.truncated) return <p className="p-4 text-sm text-muted-foreground">HTML 文件过大，请下载后查看。</p>;
  if (kind === 'html') return <HtmlPreview html={query.data.text} title={file.filename} baseHref={url} interactive={false} className="h-full min-h-0 w-full bg-white" />;
  return (
    <div className="h-full min-h-0 overflow-auto p-5 text-sm leading-relaxed">
      {kind === 'markdown' ? (
        <article className="space-y-3 break-words [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_a]:text-primary [&_a]:underline [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_table]:w-full [&_th]:border [&_td]:border [&_th]:bg-muted [&_th]:p-2 [&_td]:p-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrl} skipHtml>{query.data.text}</ReactMarkdown>
        </article>
      ) : <pre className="whitespace-pre-wrap break-words font-mono">{query.data.text}</pre>}
      {query.data.truncated && <p className="mt-4 text-xs text-muted-foreground">内容已截断，请下载查看全文。</p>}
    </div>
  );
}

function PreviewHeader({ file, onClose, modal }: { file: PreviewAttachment; onClose: () => void; modal?: boolean }) {
  const url = mxcToDownloadUrl(file.url, file.homeserver, { download: true });
  const Title = modal ? SheetTitle : 'h2';
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">文件预览</p>
        <Title className="truncate text-sm font-semibold" title={file.filename}>{file.filename}</Title>
      </div>
      {url && <Button asChild variant="ghost" size="icon" className="size-8">
        <a href={url} download aria-label="下载预览文件" title="下载"><Download className="size-4" /></a>
      </Button>}
      <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="关闭文件预览" title="关闭"><X className="size-4" /></Button>
    </div>
  );
}

export function AttachmentPreviewPanel({ file, onClose }: { file: PreviewAttachment; onClose: () => void }) {
  return <aside aria-label="文件预览" className="absolute inset-y-0 right-0 z-40 flex w-[min(42vw,36rem)] flex-col overflow-hidden border-l border-border bg-background shadow-xl max-lg:fixed max-lg:w-[min(36rem,92vw)]">
    <PreviewHeader file={file} onClose={onClose} />
    <div className="min-h-0 flex-1"><PreviewContent file={file} /></div>
  </aside>;
}

export function AttachmentPreviewDrawer({ file, onClose }: { file: PreviewAttachment; onClose: () => void }) {
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent aria-describedby={undefined} showCloseButton={false} className="gap-0 sm:max-w-xl">
      <PreviewHeader file={file} onClose={onClose} modal />
      <div className="min-h-0 flex-1"><PreviewContent file={file} /></div>
    </SheetContent>
  </Sheet>;
}
