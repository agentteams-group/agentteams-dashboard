'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronUp, ChevronDown, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DOCUMENT_PREVIEW_MAX_BYTES } from '@/lib/document-preview';

export interface DocumentSlidesProps {
  data: ArrayBuffer;
  page: number;
  onLoad: (_count: number) => void;
  onError: (_message: string) => void;
}

const PdfSlides = dynamic(() => import('./pdf-slides'), { ssr: false });
const PowerPointSlides = dynamic(() => import('./powerpoint-slides'), { ssr: false });

interface DocumentPreviewProps { url: string; filename: string; accessToken?: string; mimetype?: string }

export function DocumentPreview({ url, filename, accessToken, mimetype }: DocumentPreviewProps) {
  // A new source gets its own request, page index and parser lifetime.
  return <DocumentPreviewContent key={`${url}:${filename}:${accessToken || ''}`} url={url} filename={filename} accessToken={accessToken} mimetype={mimetype} />;
}

function DocumentPreviewContent({ url, filename, accessToken, mimetype }: DocumentPreviewProps) {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeDotRef = useRef<HTMLButtonElement>(null);
  const onLoad = useCallback((pages: number) => {
    if (pages < 1) setError('文件中没有可预览的页面');
    else setCount(pages);
  }, []);
  const onError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal, cache: 'no-store',
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > DOCUMENT_PREVIEW_MAX_BYTES) {
          throw new Error('文件超过 50 MB，请下载后查看');
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > DOCUMENT_PREVIEW_MAX_BYTES) throw new Error('文件超过 50 MB，请下载后查看');
        if (!controller.signal.aborted) setData(buffer);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '无法读取文件');
      }
    })();
    return () => controller.abort();
  }, [url, accessToken]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !count) return;
    let lastTurn = -Infinity;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      // Throttle high-frequency wheel events from trackpad momentum.
      const now = performance.now();
      if (Math.abs(event.deltaY) < 4 || now - lastTurn < 400) return;
      lastTurn = now;
      setPage((current) => Math.max(0, Math.min(count - 1, current + Math.sign(event.deltaY))));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [count]);

  useEffect(() => {
    activeDotRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [page]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p role="alert" className="text-muted-foreground">预览失败：{error}</p>
        <Button variant="outline" size="sm" asChild>
          <a href={url} download><Download className="h-3.5 w-3.5" />下载原文件</a>
        </Button>
      </div>
    );
  }

  const Slides = /\.pdf$/i.test(filename) || mimetype?.toLowerCase().split(';')[0] === 'application/pdf' ? PdfSlides : PowerPointSlides;
  return (
    <section aria-label={`${filename} 分页预览`} className="flex h-full min-h-0 min-w-0 bg-muted/30">
      <div ref={stageRef} aria-label="幻灯片画布" className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {count === 0 && (
          <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />正在加载预览…
          </div>
        )}
        {data && <Slides data={data} page={page} onLoad={onLoad} onError={onError} />}
      </div>
      {count > 0 && (
        <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-l bg-background py-2">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="上一页" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <nav aria-label="选择页面" className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto custom-scrollbar">
            {Array.from({ length: count }, (_, index) => (
              <button
                key={index}
                ref={page === index ? activeDotRef : undefined}
                type="button"
                aria-label={`第 ${index + 1} 页`}
                title={`第 ${index + 1} 页`}
                aria-current={page === index ? 'page' : undefined}
                onClick={() => setPage(index)}
                onMouseEnter={() => setPage(index)}
                className="flex h-6 w-8 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className={`h-1.5 w-1.5 rounded-full transition-[background-color,transform] ${page === index ? 'scale-150 bg-primary' : 'bg-muted-foreground/35'}`} />
              </button>
            ))}
          </nav>
          <span aria-live="polite" className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{page + 1}/{count}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="下一页" disabled={page === count - 1} onClick={() => setPage(page + 1)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      )}
    </section>
  );
}
