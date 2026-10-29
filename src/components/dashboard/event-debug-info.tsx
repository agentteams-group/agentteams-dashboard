'use client';

import { Bug } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CopyButton } from '@/components/dashboard/copy-button';

interface EventDebugInfoProps {
  eventId: string;
  /** Number of m.replace revisions merged into the message. */
  revisionCount?: number;
}

/**
 * Debug-only Matrix event id. Kept out of the default card body so routine
 * reading stays focused on the tool/thinking content; opening it reveals the
 * full id (not a truncated one) with a copy action for troubleshooting.
 */
export function EventDebugInfo({ eventId, revisionCount }: EventDebugInfoProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="event-debug-trigger"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Bug className="h-3 w-3" aria-hidden="true" />
          调试信息
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[90vw] p-3">
        <p className="text-xs font-medium text-muted-foreground">Matrix 事件 ID</p>
        <div className="mt-1 flex items-start gap-1">
          <code
            data-testid="event-chain-info"
            className="min-w-0 break-all font-mono text-xs"
          >
            {eventId}
          </code>
          <CopyButton text={eventId} label="复制事件 ID" />
        </div>
        {revisionCount ? (
          <p className="mt-2 text-xs text-muted-foreground">编辑 {revisionCount} 次</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
