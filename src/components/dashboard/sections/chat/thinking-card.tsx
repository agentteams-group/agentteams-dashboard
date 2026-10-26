'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RuntimeBadge } from '@/components/dashboard/phase-badge';
import { EventDebugInfo } from '@/components/dashboard/event-debug-info';
import { RUNTIME_LABELS } from '@/lib/phase-colors';

interface ThinkingCardProps {
  title?: string;
  content: string;
  isStreaming?: boolean;
  /** Runtime that produced this thinking block (drives the corner badge). */
  runtime?: string | null;
  /** Root Matrix event id, available via the debug affordance (AC-C7). */
  eventId?: string;
  /** Number of m.replace revisions merged into the message. */
  revisionCount?: number;
  /** Rendered as a step inside the run-process disclosure (no inner fold). */
  embedded?: boolean;
}

export function ThinkingCard({
  title,
  content,
  isStreaming,
  runtime,
  eventId,
  revisionCount,
  embedded,
}: ThinkingCardProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? Boolean(isStreaming);
  const resolvedTitle = title ?? (runtime && RUNTIME_LABELS[runtime] ? `${RUNTIME_LABELS[runtime]} · 思考过程` : '思考过程');

  if (embedded) {
    return (
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-muted-foreground">
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500" aria-hidden="true" />
          ) : (
            <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{resolvedTitle}</span>
          {runtime && <RuntimeBadge runtime={runtime} size="sm" withTooltip />}
          {isStreaming && (
            <span className="text-[10px] text-emerald-500 animate-pulse">思考中...</span>
          )}
        </div>
        <pre className={`mt-1 max-h-56 overflow-y-auto custom-scrollbar whitespace-pre-wrap font-mono text-xs text-muted-foreground ${isStreaming ? 'animate-pulse' : ''}`}>
          {content || (isStreaming ? '正在思考...' : '')}
        </pre>
        {eventId && (
          <div className="mt-2">
            <EventDebugInfo eventId={eventId} revisionCount={revisionCount} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between px-3 py-2 h-auto"
        onClick={() => setUserOpen((previous) => !(previous ?? Boolean(isStreaming)))}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground min-w-0">
          {isStreaming ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
          ) : (
            <Brain className="w-3.5 h-3.5" />
          )}
          <span className="truncate">{resolvedTitle}</span>
          {runtime && (
            <RuntimeBadge runtime={runtime} size="sm" withTooltip />
          )}
          {isStreaming && (
            <span className="text-[10px] text-emerald-500 animate-pulse">思考中...</span>
          )}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </Button>
      {open && (
        <div className="px-3 pb-3">
          <pre className={`text-xs whitespace-pre-wrap font-mono text-muted-foreground ${isStreaming ? 'animate-pulse' : ''}`}>
            {content || (isStreaming ? '正在思考...' : '')}
          </pre>
          {eventId && (
            <div className="mt-2">
              <EventDebugInfo eventId={eventId} revisionCount={revisionCount} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
