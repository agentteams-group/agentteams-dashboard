'use client';

import React from 'react';
import { Virtuoso } from 'react-virtuoso';
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
}

const _noop = () => {};

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

  const handleRangeChanged = (range: { startIndex: number; endIndex: number }) => {
    if (range.startIndex < 10 && hasNextPage && !isFetchingNextPage) {
      onLoadMore();
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${className}`}>
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
      <div className={`flex-1 overflow-y-auto flex items-center justify-center ${className}`}>
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
      itemContent={(index) => itemContent(index, items[index] as GroupedMessage)}
      style={{ height: '100%', overflow: 'hidden' }}
      className={className}
      increaseViewportBy={{ top: 400, bottom: 400 }}
      rangeChanged={handleRangeChanged}
      overscan={400}
      components={{
        Footer: () => {
          if (!hasNextPage || isFetchingNextPage) return null;
          return (
            <div className="flex justify-center py-3">
              <button
                onClick={onLoadMore}
                disabled={isFetchingNextPage}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isFetchingNextPage ? '加载中...' : '加载更早消息'}
              </button>
            </div>
          );
        },
      }}
    />
  );
});
