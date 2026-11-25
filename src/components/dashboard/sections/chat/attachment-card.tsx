'use client';

import { useContext, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import { useMatrixStore } from '@/lib/matrix-store';
import { SaveToHumanFiles } from './save-to-human-files';
import { AttachmentPreviewContext, AttachmentPreviewDrawer, attachmentPreviewKind } from './attachment-preview';
import { cn } from '@/lib/utils';

interface AttachmentCardProps {
  payload: { url: string; filename: string; mimetype: string; size?: number };
  homeserver?: string;
  compact?: boolean;
}

function attachmentType(mimetype: string, kind: ReturnType<typeof attachmentPreviewKind>) {
  if (kind === 'html') return 'HTML';
  if (kind === 'markdown') return 'Markdown';
  if (kind === 'text') return '文本';
  if (mimetype.startsWith('application/pdf')) return 'PDF';
  if (mimetype.startsWith('application/zip')) return '压缩包';
  return '文件';
}

export function AttachmentCard({ payload, homeserver, compact }: AttachmentCardProps) {
  const { homeserver: storeHomeserver } = useMatrixStore();
  const openPreview = useContext(AttachmentPreviewContext);
  const [standalonePreview, setStandalonePreview] = useState(false);
  const file = { ...payload, homeserver: homeserver || storeHomeserver };
  const download = mxcToDownloadUrl(file.url, file.homeserver, { download: true });
  const kind = attachmentPreviewKind(file);
  const type = attachmentType(payload.mimetype, kind);
  const size = file.size ? (file.size >= 1_048_576 ? `${(file.size / 1_048_576).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`) : null;

  return (
    <div className={cn('group/attachment my-2 max-w-full rounded-xl border border-border/70 bg-card transition-colors hover:border-border focus-within:border-border', compact && 'my-1 rounded-lg')}>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-3', compact && 'gap-x-2 p-2')}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground', compact && 'size-8')}>
            <FileText className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={file.filename}>{file.filename}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{type}{size ? ` · ${size}` : ''}</p>
          </div>
        </div>
        {download && <div className="ml-auto flex shrink-0 items-center gap-1">
          <SaveToHumanFiles filename={file.filename} mediaUrl={file.url} homeserver={file.homeserver} iconsOnly />
          <Button asChild variant="ghost" size="icon" className="size-8 text-muted-foreground">
            <a href={download} download target="_blank" rel="noopener noreferrer" aria-label={`下载 ${file.filename}`} title="下载"><Download className="size-4" /></a>
          </Button>
          {kind && <Button variant="outline" size="sm" className="h-8 rounded-lg px-2.5"
            aria-label={`查看 ${file.filename}`}
            onClick={event => { event.stopPropagation(); if (openPreview) openPreview(file); else setStandalonePreview(true); }}>
            查看
          </Button>}
        </div>}
      </div>
      {standalonePreview && <AttachmentPreviewDrawer file={file} onClose={() => setStandalonePreview(false)} />}
    </div>
  );
}
