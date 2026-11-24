'use client';

import { ReactPptxViewer, setWasmSource } from '@extend-ai/react-pptx';
import '@extend-ai/react-pptx/styles.css';
import type { DocumentSlidesProps } from './document-preview';

setWasmSource(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/document-preview/pptx_wasm_bg.wasm`);

export default function PowerPointSlides({ data, page, onLoad, onError }: DocumentSlidesProps) {
  return (
    <ReactPptxViewer
      source={data}
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
