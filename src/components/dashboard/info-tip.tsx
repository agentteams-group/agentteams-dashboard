'use client';

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface InfoTipProps {
  /** Hover/focus explanation. Keep it short: one concept, 1-2 sentences. */
  children: ReactNode;
  /** Accessible name for the trigger (the visible glyph is decorative). */
  label: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Compact ⓘ affordance for explanations that used to occupy a full paragraph
 * of the form. Keeps the default view focused on labels and controls while
 * preserving discoverability via hover and keyboard focus.
 */
export function InfoTip({ children, label, className, iconClassName }: InfoTipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className,
          )}
        >
          <Info className={cn('h-3.5 w-3.5', iconClassName)} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}
