'use client';

import { Info } from 'lucide-react';
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
          aria-label="查看消息详情"
          title="查看消息详情"
          className="inline-flex items-center rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
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
