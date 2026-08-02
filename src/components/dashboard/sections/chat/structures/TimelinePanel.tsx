'use client';

import { forwardRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ScrollPanel, type ScrollPanelHandle } from './ScrollPanel';
import { ReadMarker } from '../components/ReadMarker';
import type { GroupedMessage } from '../grouper/MainGrouper';

export type TimelineItem =
  | { kind: 'message'; gm: GroupedMessage }
  | { kind: 'read-marker'; key: string };

export interface TimelinePanelProps {
  items: GroupedMessage[];
  /** Message id the read marker should be anchored after. */
  readEventId?: string | null;
  itemContent: (_index: number, _item: GroupedMessage) => ReactNode;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  loading?: boolean;
  emptyContent?: ReactNode;
  onAtBottomChange?: (_atBottom: boolean) => void;
  className?: string;
}

function matchesReadEvent(gm: GroupedMessage, readEventId: string): boolean {
  return gm.message.id === readEventId || gm.message.eventId === readEventId;
}

function buildTimelineItems(items: GroupedMessage[], readEventId: string | null | undefined): TimelineItem[] {
  const entries: TimelineItem[] = items.map((gm) => ({ kind: 'message' as const, gm }));

  if (!readEventId) return entries;

  let readIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind === 'message' && matchesReadEvent(entry.gm, readEventId)) {
      readIndex = i;
      break;
    }
  }

  if (readIndex >= 0) {
    entries.splice(readIndex + 1, 0, {
      kind: 'read-marker',
      key: `read-marker-${readEventId}`,
    });
  }

  return entries;
}

export const TimelinePanel = forwardRef<ScrollPanelHandle, TimelinePanelProps>(function TimelinePanel(
  {
    items,
    readEventId,
    itemContent,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
    loading,
    emptyContent,
    onAtBottomChange,
    className,
  },
  ref
) {
  const timelineItems = useMemo(() => buildTimelineItems(items, readEventId), [items, readEventId]);

  const scrollItemContent = useCallback(
    (_index: number, _item: GroupedMessage) => {
      const item = _item as unknown as TimelineItem;
      if (item.kind === 'read-marker') {
        return <ReadMarker key={item.key} />;
      }
      return itemContent(_index, item.gm);
    },
    [itemContent]
  );

  return (
    <ScrollPanel
      ref={ref}
      items={timelineItems as unknown as GroupedMessage[]}
      itemContent={scrollItemContent}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={onLoadMore}
      loading={loading}
      emptyContent={emptyContent}
      onAtBottomChange={onAtBottomChange}
      className={className}
    />
  );
});
