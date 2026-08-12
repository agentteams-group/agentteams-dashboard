'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RuntimeBadge } from '@/components/dashboard/phase-badge';
import { RUNTIME_LABELS } from '@/lib/phase-colors';

interface ThinkingCardProps {
  title?: string;
  content: string;
  isStreaming?: boolean;
  /** Runtime that produced this thinking block (drives the corner badge). */
  runtime?: string | null;
  /** Root Matrix event id, shown when the card is expanded (AC-C7). */
  eventId?: string;
  /** Number of m.replace revisions merged into the message. */
  revisionCount?: number;
}

function truncateEventId(eventId: string): string {
  return eventId.length > 18 ? `${eventId.slice(0, 12)}…${eventId.slice(-4)}` : eventId;
}

export function ThinkingCard({
  title,
  content,
  isStreaming,
  runtime,
  eventId,
  revisionCount,
}: ThinkingCardProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? Boolean(isStreaming);
  const resolvedTitle = title ?? (runtime && RUNTIME_LABELS[runtime] ? `${RUNTIME_LABELS[runtime]} · 思考过程` : '思考过程');

  return (
    <div className="my-2 rounded-lg border bg-muted/30 overflow-hidden">
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
            <p className="mt-2 text-[10px] text-muted-foreground/60 font-mono" data-testid="event-chain-info">
              事件 {truncateEventId(eventId)}
              {revisionCount ? ` · 编辑 ${revisionCount} 次` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
