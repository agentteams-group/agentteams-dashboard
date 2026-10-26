'use client';

import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import type { DisplayMessage } from '@/hooks/use-matrix';
import type { GroupedMessage } from '../grouper/MainGrouper';
import { formatTime } from '../format';

export interface TimelineRailHandle {
  /** Reports the data indices currently rendered in the viewport. */
  setRange: (_startIndex: number, _endIndex: number) => void;
}

interface TimelineRailProps {
  items: GroupedMessage[];
  onJump: (_index: number) => void;
}

/** A short conversation does not need a jump rail. */
const MIN_ITEMS = 6;
/** One dash per message until the rail would get crowded. */
const MAX_TICKS = 40;

interface RailTick {
  index: number;
  count: number;
  label: string;
  unread: boolean;
}

function messageOf(item: GroupedMessage): DisplayMessage | null {
  const entry = item as unknown as { gm?: GroupedMessage; message?: DisplayMessage };
  return entry.gm?.message ?? entry.message ?? null;
}

function isReadMarker(item: GroupedMessage): boolean {
  return (item as unknown as { kind?: string }).kind === 'read-marker';
}

/**
 * The rail is a position map, not a 1:1 message list: a long room is bucketed
 * so the dashes keep spreading over the full height of the scroller.
 */
function buildTicks(items: GroupedMessage[]): RailTick[] {
  if (items.length < MIN_ITEMS) return [];
  const bucketSize = Math.ceil(items.length / MAX_TICKS);
  const ticks: RailTick[] = [];

  for (let start = 0; start < items.length; start += bucketSize) {
    const end = Math.min(start + bucketSize, items.length);
    const slice = items.slice(start, end);
    const unread = slice.some(isReadMarker);
    const first = slice.map(messageOf).find((message) => message !== null);
    const span = end - start;
    const label = unread
      ? '未读消息'
      : first
        ? `${first.senderShort} · ${formatTime(first.timestamp)}${span > 1 ? `（${span} 条）` : ''}`
        : `第 ${start + 1} 条`;
    ticks.push({ index: start, count: span, label, unread });
  }

  return ticks;
}

/**
 * Qoder-style scroll rail: one dash per stretch of the conversation, the
 * dashes covering the current viewport widen, and a dash is clickable.
 */
export const TimelineRail = forwardRef<TimelineRailHandle, TimelineRailProps>(function TimelineRail(
  { items, onJump },
  ref
) {
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  useImperativeHandle(ref, () => ({
    setRange: (start, end) => {
      setRange((previous) =>
        previous && previous.start === start && previous.end === end
          ? previous
          : { start, end }
      );
    },
  }), []);

  const ticks = useMemo(() => buildTicks(items), [items]);

  if (ticks.length === 0) return null;

  return (
    <nav
      aria-label="会话导航"
      data-testid="timeline-rail"
      className="pointer-events-none absolute inset-y-3 right-1.5 z-10 flex w-3 flex-col items-center justify-between"
    >
      {ticks.map((tick, tickIndex) => {
        const last = tick.index + tick.count - 1;
        const active = range !== null && range.start <= last && range.end >= tick.index;
        const tone = tick.unread
          ? active
            ? 'w-3 bg-primary'
            : 'w-1.5 bg-primary/45 hover:w-3 hover:bg-primary/70'
          : active
            ? 'w-3 bg-muted-foreground/70'
            : 'w-1.5 bg-muted-foreground/25 hover:w-3 hover:bg-muted-foreground/50';
        return (
          <button
            key={tick.index}
            type="button"
            aria-label={tick.label}
            title={tick.label}
            data-testid={`rail-tick-${tickIndex}`}
            onClick={() => onJump(tick.index)}
            className={`pointer-events-auto h-[2px] shrink-0 cursor-pointer rounded-full transition-[width,background-color] duration-150 ${tone}`}
          />
        );
      })}
    </nav>
  );
});
