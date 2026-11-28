'use client';

import { useState } from 'react';
import { Download, Loader2, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function TreeRow({
  label,
  icon: Icon,
  depth = 0,
  selected,
  onClick,
  trailing,
}: {
  label: string;
  icon: LucideIcon;
  depth?: number;
  selected: boolean;
  onClick: () => void;
  trailing?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-muted ${
        selected ? 'bg-muted font-medium' : ''
      }`}
      style={{ marginLeft: depth * 12 }}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {trailing && <span className="ml-auto text-xs text-muted-foreground">{trailing}</span>}
    </div>
  );
}

/** 下载（fetch→blob，代理透传 controller JSON 错误体→toast 真实原因）。
 *  与 projects-section 的 ArtifactLink 同款语义（独立实现避免跨 section 耦合）。 */
export function ArtifactDownloadButton({
  href,
  filename,
  withLabel = false,
}: {
  href: string;
  filename: string;
  withLabel?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(href, { cache: 'no-store' });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (typeof body?.message === 'string' && body.message) detail = body.message;
          else if (typeof body?.error === 'string' && body.error) detail = body.error;
        } catch {
          // non-JSON error body
        }
        toast.error(`下载失败：${detail}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`下载失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Button
      variant="ghost"
      size={withLabel ? 'sm' : 'icon'}
      className={withLabel ? 'h-7 text-xs' : 'h-7 w-7'}
      title="下载"
      disabled={downloading}
      onClick={() => void handleDownload()}
    >
      {downloading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {withLabel && '下载'}
    </Button>
  );
}
