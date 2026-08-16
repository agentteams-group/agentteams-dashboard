'use client';

import { useEffect, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MediaViewerProps {
  /** Direct HTTP URL of the full-size media. */
  src: string;
  /** Filename shown in the header and used by the download link. */
  filename: string;
  onClose: () => void;
}

/**
 * Full-screen image lightbox for chat media messages (element-web style).
 * Click backdrop / Esc / X to close; header offers a forced-download link.
 * Rendered via a portal-free fixed overlay; keyboard handling is local.
 */
export function MediaViewer({ src, filename, onClose }: MediaViewerProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const downloadHref = (() => {
    // src may be relative (Next.js media proxy) — plain string concat handles
    // both relative and absolute URLs without URL() parsing.
    if (src.includes('download=true')) return src;
    return src.includes('?') ? `${src}&download=true` : `${src}?download=true`;
  })();

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`图片预览 ${filename}`}
      onClick={onClose}
    >
      {/* Header: filename + actions. stopPropagation keeps clicks from closing. */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 text-white/90 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm truncate flex-1">{filename}</p>
        <a
          href={downloadHref}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 h-8 text-xs bg-white/10 hover:bg-white/20 transition-colors"
          title="下载图片"
        >
          <Download className="w-3.5 h-3.5" />
          下载
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/20"
          onClick={onClose}
          title="关闭 (Esc)"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      {/* Image stage */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4" onClick={onClose}>
        {loading && !failed && (
          <Loader2 className="w-8 h-8 text-white/70 animate-spin" />
        )}
        {failed && (
          <p className="text-sm text-white/70">图片加载失败，请尝试下载查看</p>
        )}
        <img
          src={src}
          alt={filename}
          className={
            loading || failed
              ? 'hidden'
              : 'max-w-full max-h-full object-contain rounded-lg shadow-2xl'
          }
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
