'use client';

import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentSlidesProps } from './document-preview';

GlobalWorkerOptions.workerSrc = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/document-preview/pdf.worker.min.mjs`;

export default function PdfSlides({ data, page, onLoad, onError }: DocumentSlidesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    // PDF.js transfers its input buffer to the worker; keep the source reusable
    // across React Strict Mode's setup/cleanup/setup cycle.
    const assetBase = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/document-preview/`;
    const task = getDocument({
      data: data.slice(0),
      cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`,
    });
    let cancelled = false;
    void task.promise.then((pdf) => {
      if (cancelled) return;
      setDocument(pdf);
      onLoad(pdf.numPages);
    }).catch((err: Error) => { if (!cancelled) onError(err.message); });
    return () => { cancelled = true; void task.destroy(); };
  }, [data, onLoad, onError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas || !size.width || !size.height) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    canvas.style.visibility = 'hidden';
    void (async () => {
      try {
        const pdfPage = await document.getPage(page + 1);
        if (cancelled) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(size.width / original.width, size.height / original.height);
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: scale * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${viewport.width / ratio}px`;
        canvas.style.height = `${viewport.height / ratio}px`;
        renderTask = pdfPage.render({ canvas, viewport });
        await renderTask.promise;
        if (!cancelled) canvas.style.visibility = 'visible';
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : '无法渲染页面');
      }
    })();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [document, page, size, onError]);

  return <div ref={hostRef} className="flex h-full w-full items-center justify-center p-3"><canvas ref={canvasRef} aria-label={`第 ${page + 1} 页`} className="bg-white shadow-sm" /></div>;
}
