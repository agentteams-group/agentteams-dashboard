'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
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
/** Dash height and the fixed gap between dashes: the rail keeps this pitch. */
const TICK_HEIGHT = 2;
const TICK_GAP = 10;
const TICK_PITCH = TICK_HEIGHT + TICK_GAP;
/** Past this many dashes the buckets stop getting finer. */
const MAX_TICKS = 120;
/** Used before the rail has been measured (SSR, jsdom, first paint). */
const UNMEASURED_TICKS = 40;

interface RailTick {
  index: number;
  count: number;
  label: string;
  unread: boolean;
}

/**
 * Dash count follows the rail height so the pitch stays constant: a tall
 * scroller gets a denser map instead of a handful of dashes stretched apart,
 * and the column never overflows its container.
 */
export function tickLimitFor(railHeight: number): number {
  if (railHeight <= 0) return UNMEASURED_TICKS;
  return Math.max(1, Math.min(MAX_TICKS, Math.floor((railHeight + TICK_GAP) / TICK_PITCH)));
}

function messageOf(item: GroupedMessage): DisplayMessage | null {
  const entry = item as unknown as { gm?: GroupedMessage; message?: DisplayMessage };
  return entry.gm?.message ?? entry.message ?? null;
}

function isReadMarker(item: GroupedMessage): boolean {
  return (item as unknown as { kind?: string }).kind === 'read-marker';
}

/**
 * The rail is a position map, not a 1:1 message list: rooms longer than the
 * dash budget are bucketed so one dash stands for a stretch of messages.
 */
function buildTicks(items: GroupedMessage[], tickLimit: number): RailTick[] {
  if (items.length < MIN_ITEMS) return [];
  const bucketSize = Math.max(1, Math.ceil(items.length / Math.min(items.length, tickLimit)));
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
  const [railHeight, setRailHeight] = useState(0);
  const railRef = useRef<HTMLElement>(null);
  const mounted = items.length >= MIN_ITEMS;

  useImperativeHandle(ref, () => ({
    setRange: (start, end) => {
      setRange((previous) =>
        previous && previous.start === start && previous.end === end
          ? previous
          : { start, end }
      );
    },
  }), []);

  // The rail spans the scroller height, so it only needs re-measuring when it
  // mounts or the panel resizes.
  useEffect(() => {
    const element = railRef.current;
    if (!element) return;
    setRailHeight(element.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setRailHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted]);

  const ticks = useMemo(() => buildTicks(items, tickLimitFor(railHeight)), [items, railHeight]);

  const jump = useCallback((index: number) => onJump(index), [onJump]);

  if (ticks.length === 0) return null;

  return (
    <nav
      ref={railRef}
      aria-label="会话导航"
      data-testid="timeline-rail"
      style={{ gap: `${TICK_GAP}px` }}
      className="pointer-events-none absolute inset-y-3 right-1.5 z-10 flex w-3.5 flex-col items-center overflow-hidden"
    >
      {ticks.map((tick, tickIndex) => {
        const last = tick.index + tick.count - 1;
        const active = range !== null && range.start <= last && range.end >= tick.index;
        const tone = tick.unread
          ? active
            ? 'w-3.5 bg-primary'
            : 'w-2 bg-primary/45 hover:w-3.5 hover:bg-primary/75'
          : active
            ? 'w-3.5 bg-muted-foreground/70'
            : 'w-2 bg-muted-foreground/25 hover:w-3.5 hover:bg-muted-foreground/55';
        return (
          <button
            key={tick.index}
            type="button"
            aria-label={tick.label}
            title={tick.label}
            data-testid={`rail-tick-${tickIndex}`}
            onClick={() => jump(tick.index)}
            style={{ height: `${TICK_HEIGHT}px` }}
            className={`pointer-events-auto shrink-0 cursor-pointer rounded-full transition-all duration-200 ease-out ${tone}`}
          />
        );
      })}
    </nav>
  );
});
