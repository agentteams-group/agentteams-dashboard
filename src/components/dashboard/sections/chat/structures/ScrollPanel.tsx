'use client';

import React, { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { GroupedMessage } from '../grouper/MainGrouper';

export interface ScrollPanelHandle {
  scrollToBottom: (_options?: { smooth?: boolean }) => void;
  scrollToIndex: (_index: number) => void;
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
 * Plain-scroll timeline (non-virtualized), mirroring the v1.2.0 chat behavior:
 * a freshly opened room lands on the latest message, new messages auto-scroll
 * only while the user is pinned to the bottom, and scrolling up pauses the
 * follow until the user returns (or clicks the jump-to-latest button).
 */
export const ScrollPanel = React.forwardRef<ScrollPanelHandle, ScrollPanelProps>(function ScrollPanel(
  {
    items,
    itemContent,
    loading,
    emptyContent,
    className,
    onAtBottomChange,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const initialMountRef = useRef(true);
  const lastItemsCountRef = useRef(0);

  // Notify the parent whenever the scroller enters or leaves the bottom zone.
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    if (atBottomRef.current !== atBottom) {
      atBottomRef.current = atBottom;
      onAtBottomChange?.(atBottom);
    }
  }, [onAtBottomChange]);

  // A freshly opened room should land on the latest message as soon as the
  // first page arrives (the initial render is empty).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || items.length === 0) return;
    if (initialMountRef.current) {
      initialMountRef.current = false;
      el.scrollTop = el.scrollHeight;
      onAtBottomChange?.(true);
    }
  }, [items, onAtBottomChange]);

  // Follow newly appended messages only while pinned to the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || items.length === 0) return;
    const wasEmpty = lastItemsCountRef.current === 0;
    const appended = items.length > lastItemsCountRef.current;
    lastItemsCountRef.current = items.length;
    if (appended && (atBottomRef.current || wasEmpty)) {
      el.scrollTop = el.scrollHeight;
      onAtBottomChange?.(true);
    }
  }, [items, onAtBottomChange]);

  useImperativeHandle(ref, () => ({
    scrollToBottom: (_options = { smooth: true }) => {
      const el = containerRef.current;
      if (!el) return;
      if (_options.smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      atBottomRef.current = true;
      onAtBottomChange?.(true);
    },
    scrollToIndex: (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      const target = el.querySelector(`[data-timeline-index="${index}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    },
  }));

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
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto custom-scrollbar ${className ?? ''}`}
    >
      <div className="flex flex-col gap-0.5 px-4 py-2">
        {items.map((item, index) => (
          <div key={index} data-timeline-index={index}>
            {itemContent(index, item)}
          </div>
        ))}
      </div>
    </div>
  );
});
