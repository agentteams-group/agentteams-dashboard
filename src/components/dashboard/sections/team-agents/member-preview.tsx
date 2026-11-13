'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function MemberPreview({ name, label, onOpen, children }: {
  name: string; label?: string; onOpen: () => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => { cancelClose(); setOpen(true); };
  const hideSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return <Popover open={open} onOpenChange={(value) => { cancelClose(); setOpen(value); }}>
    <PopoverTrigger asChild>
      <button type="button" onClick={onOpen} onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={hideSoon}
        className="inline-flex max-w-full items-center rounded-lg border border-transparent bg-muted/50 px-2 py-1 text-xs transition-colors hover:border-emerald-500/25 hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`查看 ${name} 的主页`}>
        <span className="truncate">{label || name}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent aria-label={`${label || name} 资料卡`} side="right" align="start" sideOffset={12} collisionPadding={16}
      className="w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border-0 bg-card p-0 text-card-foreground shadow-xl"
      onMouseEnter={show} onMouseLeave={hideSoon} onFocusCapture={cancelClose}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hideSoon(); }}
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      {children}
    </PopoverContent>
  </Popover>;
}
