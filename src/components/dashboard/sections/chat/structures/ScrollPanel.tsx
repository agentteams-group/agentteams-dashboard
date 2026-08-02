'use client';

import React from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { GroupedMessage } from '../grouper/MainGrouper';

export interface ScrollPanelHandle {
  scrollToBottom: (options?: { smooth?: boolean }) => void;
  scrollToIndex: (index: number) => void;
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

const FIRST_ITEM_INDEX = 100000;

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
  const virtuosoRef = React.useRef<import('react-virtuoso').VirtuosoHandle>(null);

  React.useImperativeHandle(ref, () => ({
    scrollToBottom: (_options = { smooth: true }) => {
      virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: _options.smooth ? 'smooth' : 'auto' });
    },
    scrollToIndex: (_index: number) => {
      virtuosoRef.current?.scrollToIndex({ index: _index, align: 'end', behavior: 'smooth' });
    },
  }));

  const handleStartReached = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      onLoadMore();
    }
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const handleAtBottomChange = React.useCallback((atBottom: boolean) => {
    onAtBottomChange?.(atBottom);
  }, [onAtBottomChange]);

  if (loading && items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Array.from({ length: 8 }).map((_i, i) => (
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
    <Virtuoso
      ref={virtuosoRef}
      data={items}
      itemContent={(_index, _item) => itemContent(_index, _item as GroupedMessage)}
      style={{ height: '100%' }}
      // Offset indices so prepending older pages keeps the viewport anchored
      // on the same message instead of jumping to the top.
      firstItemIndex={FIRST_ITEM_INDEX}
      initialTopMostItemIndex={items.length - 1}
      // Sticky bottom: follow new messages only while the user is at the bottom.
      followOutput="auto"
      atBottomStateChange={handleAtBottomChange}
      atBottomThreshold={60}
      // Older messages live at the top of the list, so the pagination spinner
      // and the load trigger both belong to the header edge.
      startReached={handleStartReached}
      increaseViewportBy={{ top: 400, bottom: 400 }}
      overscan={400}
    />
  );
});
