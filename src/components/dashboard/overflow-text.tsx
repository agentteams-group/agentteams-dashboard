'use client';

import { useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Keep summaries bounded while exposing the complete value on hover or focus. */
export function OverflowText({ text, className, multiline = false, onClick }: {
  text: string; className?: string; multiline?: boolean; onClick?: () => void;
}) {
  const element = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const props = {
    ref: (node: HTMLElement | null) => { element.current = node; },
    className: cn('block min-w-0 max-w-full text-left', multiline ? 'line-clamp-2 whitespace-normal [overflow-wrap:anywhere]' : 'truncate', className),
  };
  return <Tooltip open={open} onOpenChange={(value) => {
    const node = element.current;
    setOpen(Boolean(value && node && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight)));
  }}>
    <TooltipTrigger asChild>
      {onClick ? <button type="button" {...props} onClick={onClick}>{text}</button> : <span {...props} tabIndex={0}>{text}</span>}
    </TooltipTrigger>
    <TooltipContent sideOffset={6} className="max-h-64 max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-popover p-3 text-left text-popover-foreground shadow-md [&>svg]:bg-popover [&>svg]:fill-popover">{text}</TooltipContent>
  </Tooltip>;
}
