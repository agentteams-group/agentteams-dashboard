'use client';

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';

let composingElement: EventTarget | null = null;

export function isComposing(): boolean {
  if (composingElement instanceof Node && !composingElement.isConnected) composingElement = null;
  return composingElement !== null;
}

export function isDesktopHover(event: { pointerType: string }): boolean {
  return event.pointerType === 'mouse' && !isComposing()
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function useDesktopInputFocus() {
  useEffect(() => {
    const start = (event: CompositionEvent) => { composingElement = event.target; };
    const end = () => { composingElement = null; };
    const hover = (event: globalThis.PointerEvent) => {
      if (!isDesktopHover(event)) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target instanceof HTMLInputElement && !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type)) return;
      if (!target.disabled && !target.readOnly && document.activeElement !== target) target.focus({ preventScroll: true });
    };
    document.addEventListener('compositionstart', start, true);
    document.addEventListener('compositionend', end, true);
    document.addEventListener('pointerover', hover, { passive: true });
    return () => {
      composingElement = null;
      document.removeEventListener('compositionstart', start, true);
      document.removeEventListener('compositionend', end, true);
      document.removeEventListener('pointerover', hover);
    };
  }, []);
}

export function useHoverOpen({ open, defaultOpen = false, onOpenChange }: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (_open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const id = useId();
  const setOpen = useCallback((value: boolean) => {
    if (open === undefined) setLocalOpen(value);
    onOpenChange?.(value);
  }, [open, onOpenChange]);
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const enter = (event: PointerEvent<HTMLElement>) => {
    if (!isDesktopHover(event)) return;
    cancelClose();
    hovered.current = true;
    if (!(open ?? localOpen)) setOpen(true);
  };
  const leave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest(`[data-hover-region="${id}"]`)) return;
    cancelClose();
    timer.current = setTimeout(() => { if (!isComposing()) setOpen(false); }, 100);
  };
  const preserveFocus = (event: Event) => { if (hovered.current) event.preventDefault(); };
  return {
    open: open ?? localOpen,
    setOpen,
    triggerProps: {
      'data-hover-region': id,
      onPointerEnter: enter,
      onPointerLeave: leave,
      onPointerDown: () => { hovered.current = false; },
      onKeyDown: () => { hovered.current = false; },
    },
    contentProps: { 'data-hover-region': id, onPointerEnter: enter, onPointerLeave: leave },
    preserveFocus,
  };
}
