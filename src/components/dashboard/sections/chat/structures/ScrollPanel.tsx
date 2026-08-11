'use client';

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { GroupedMessage } from '../grouper/MainGrouper';

export interface ScrollPanelHandle {
  scrollToBottom: (_options?: { smooth?: boolean }) => void;
  scrollToIndex: (_index: number) => void;
  /** Scrolls the first timeline item whose key matches (read-marker divider, message id/event id). */
  scrollToItem: (_key: string) => void;
}

interface ScrollPanelProps {
  items: GroupedMessage[];
  itemContent: (_index: number, _item: GroupedMessage) => React.ReactNode;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  loading?: boolean;
  emptyContent?: React.ReactNode;
  className?: string;
  /** Called whenever the scroller enters or leaves the bottom (sticky) position. */
  onAtBottomChange?: (_atBottom: boolean) => void;
}

/**
 * How close to the bottom counts as "at bottom". While the user is within this
 * window new messages keep the list pinned to the latest message; scrolling
 * further up pauses the auto-follow (matching the v1.2.0 behavior).
 */
const BOTTOM_THRESHOLD = 100;

/**
 * Virtualized timeline that preserves the chat behavior: a freshly opened room
 * lands on the latest message, appended messages follow only while pinned to
 * the bottom, and older messages load from the top edge.
 */
export const ScrollPanel = React.forwardRef<ScrollPanelHandle, ScrollPanelProps>(function ScrollPanel(
  {
    items,
    itemContent,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
    loading,
    emptyContent,
    className,
    onAtBottomChange,
  },
  ref
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const initialMountRef = useRef(true);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    if (atBottomRef.current !== atBottom) {
      atBottomRef.current = atBottom;
      onAtBottomChange?.(atBottom);
    }
  }, [onAtBottomChange]);

  // A freshly opened room should land on the unread divider when one exists
  // (read position behind the latest message) and otherwise on the latest
  // message. Landing on the divider must NOT push the read position forward,
  // so the initial mount never reports "at bottom" while a divider is shown.
  useEffect(() => {
    if (items.length === 0 || !initialMountRef.current) return;
    initialMountRef.current = false;
    const markerIndex = items.findIndex(
      (item) => (item as unknown as { kind?: string }).kind === 'read-marker'
    );
    if (markerIndex >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: markerIndex, align: 'start' });
      atBottomRef.current = false;
    } else {
      virtuosoRef.current?.scrollToIndex({ index: items.length - 1, align: 'end' });
      atBottomRef.current = true;
    }
  }, [items]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const highlightIndex = useCallback((index: number) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedIndex(index);
    highlightTimerRef.current = setTimeout(() => setHighlightedIndex(null), 1800);
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToBottom: (_options = { smooth: true }) => {
      if (items.length === 0) return;
      virtuosoRef.current?.scrollToIndex({
        index: items.length - 1,
        align: 'end',
        behavior: _options.smooth ? 'smooth' : 'auto',
      });
      atBottomRef.current = true;
      onAtBottomChange?.(true);
    },
    scrollToIndex: (index: number) => {
      if (index < 0 || index >= items.length) return;
      virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' });
      highlightIndex(index);
    },
    scrollToItem: (key: string) => {
      const index = items.findIndex((item) => {
        const t = item as unknown as { key?: string; gm?: GroupedMessage };
        return (
          t.key === key ||
          t.gm?.message.id === key ||
          (item as { message?: { id: string } }).message?.id === key
        );
      });
      if (index < 0) return;
      virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' });
      highlightIndex(index);
    },
  }), [highlightIndex, items, onAtBottomChange]);

  if (loading && items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Array.from({ length: 8 }).map((_e, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-20 bg-muted rounded animate-pulse" />
              <div className="h-16 w-3/4 bg-muted rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0 && !loading) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center">
        {emptyContent || (
          <div className="text-center text-muted-foreground">
            <p>暂无消息</p>
            <p className="text-xs mt-1">发送第一条消息开始对话</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <span className="sr-only" aria-live="polite">
        {highlightedIndex === null ? '' : `已定位到第 ${highlightedIndex + 1} 条消息`}
      </span>
      <Virtuoso
        ref={virtuosoRef}
        className={`flex-1 custom-scrollbar ${className ?? ''}`}
        data={items}
        computeItemKey={(index, item) => {
          const timelineItem = item as unknown as { key?: string; gm?: GroupedMessage };
          return timelineItem.key ?? timelineItem.gm?.message.id ?? item.message?.id ?? index;
        }}
        itemContent={(index, item) => (
          <div
            data-timeline-index={index}
            className={`px-4 py-0.5 transition-[background-color,box-shadow] duration-300 ${
              highlightedIndex === index ? 'rounded-md bg-primary/10 ring-1 ring-primary/40' : ''
            }`}
          >
            {itemContent(index, item)}
          </div>
        )}
        atBottomThreshold={BOTTOM_THRESHOLD}
        atBottomStateChange={handleAtBottomChange}
        followOutput={(isAtBottom) => (atBottomRef.current || isAtBottom ? 'auto' : false)}
        startReached={() => {
          if (hasNextPage && !isFetchingNextPage) onLoadMore();
        }}
      />
    </>
  );
});
