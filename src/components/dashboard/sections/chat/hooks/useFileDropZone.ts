'use client';

import { useCallback, useRef, useState } from 'react';
import type { DragEvent, RefObject } from 'react';

/**
 * Drop zone for files dragged onto a container element.
 *
 * Drag events fire on every child element the cursor passes over, so naive
 * `onDragEnter`/`onDragLeave` toggles flicker as the cursor crosses the
 * container's children. The hook tracks an enter/leave counter and only
 * flips the overlay on the actual outer boundary.
 *
 * Non-`Files` drags (text, links, internal DnD) are ignored so the overlay
 * does not appear for drags the handler cannot service.
 */
export interface UseFileDropZoneResult {
  dragActive: boolean;
  dropZoneProps: {
    onDragEnter: (_event: DragEvent<HTMLElement>) => void;
    onDragOver: (_event: DragEvent<HTMLElement>) => void;
    onDragLeave: (_event: DragEvent<HTMLElement>) => void;
    onDrop: (_event: DragEvent<HTMLElement>) => void;
  };
  /** Re-bind a container ref at runtime. */
  containerRef: RefObject<HTMLElement | null>;
}

export interface UseFileDropZoneInput {
  onFiles: (_files: File[]) => void;
}

export function useFileDropZone({ onFiles }: UseFileDropZoneInput): UseFileDropZoneResult {
  const containerRef = useRef<HTMLElement>(null);
  const counterRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const isFileDrag = useCallback((event: DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer.types).includes('Files');
  }, []);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      counterRef.current += 1;
      if (counterRef.current === 1) setDragActive(true);
    },
    [isFileDrag],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
    },
    [isFileDrag],
  );

  const onDragLeave = useCallback((_event: DragEvent<HTMLElement>) => {
    counterRef.current = Math.max(0, counterRef.current - 1);
    if (counterRef.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      counterRef.current = 0;
      setDragActive(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [isFileDrag, onFiles],
  );

  return {
    dragActive,
    containerRef,
    dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}