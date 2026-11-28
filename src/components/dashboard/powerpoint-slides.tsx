'use client';

import { useEffect, useMemo, useState } from 'react';
import { ReactPptxViewer, usePptxPresentation } from '@extend-ai/react-pptx';
import '@extend-ai/react-pptx/styles.css';
import type { PptxFontOptions } from '@extend-ai/react-pptx';
import { selectPptxFonts } from '@/lib/pptx-fonts';
import type { DocumentSlidesProps } from './document-preview';

export default function PowerPointSlides({ data, page, onLoad, onError }: DocumentSlidesProps) {
  const parsed = usePptxPresentation(data);
  const [fonts, setFonts] = useState<PptxFontOptions | null>(null);

  useEffect(() => {
    if (!parsed.presentation) return;
    let cancelled = false;
    void selectPptxFonts(parsed.presentation).then((selected) => {
      if (!cancelled) setFonts(selected);
    });
    return () => { cancelled = true; };
  }, [parsed.presentation]);

  useEffect(() => {
    if (parsed.error) onError(parsed.error.message);
  }, [parsed.error, onError]);

  const source = parsed.presentation;
  const fontOptions = useMemo(() => fonts ?? {
    useOfficeFallbacks: false,
    loadEmbeddedFonts: true,
    waitForFonts: true,
    loadTimeoutMs: 3000,
  }, [fonts]);

  if (!source || !fonts) return null;
  return (
    <ReactPptxViewer
      source={source}
      fonts={fontOptions}
      mode="slide"
      slideIndex={page}
      zoom="fit-page"
      height="100%"
      showToolbar={false}
      showThumbnails={false}
      showSlideLabels={false}
      onLoad={(presentation) => onLoad(presentation.document.slides.length)}
      onError={(error) => onError(error.message)}
      renderLoading={() => null}
      style={{ border: 0, background: 'transparent' }}
      viewportStyle={{ padding: 16, background: 'var(--muted)', display: 'grid', placeItems: 'center' }}
      className="h-full min-h-0"
    />
  );
}
