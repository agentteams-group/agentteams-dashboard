'use client';

import { useCallback, useMemo } from 'react';
import { ScrollPanel } from './ScrollPanel';
import { buildGroupedMessages, type GroupedMessage } from '../grouper/MainGrouper';
import { EventTile } from '../views/EventTile';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { MessageInput } from '../components/MessageInput';

interface MessageListProps {
  messages: DisplayMessage[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  _autoScroll: boolean;
  _onAutoScrollChange: (_auto: boolean) => void;
  _newMessagesCount: number;
  _onJumpToNew: () => void;
  loading: boolean;
  className?: string;
  canSend: boolean;
  onSend: (_content: string, _options?: { html?: boolean }) => void;
}

export function MessageList({
  messages,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  _autoScroll,
  _onAutoScrollChange,
  _newMessagesCount,
  _onJumpToNew,
  loading,
  className,
  canSend,
  onSend,
}: MessageListProps) {
  const grouped = useMemo(() => buildGroupedMessages(messages), [messages]);

  const itemContent = useCallback((index: number, _item: GroupedMessage) => {
    const gm = grouped[index];
    if (!gm) return null;
    return (
      <EventTile
        key={gm.message.id}
        message={gm.message}
        showSender={gm.showSender}
        isContinuation={gm.isContinuation}
      />
    );
  }, [grouped]);

  return (
    <div className="flex flex-col h-full">
      <ScrollPanel
        items={grouped}
        itemContent={itemContent}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={onLoadMore}
        loading={loading}
        className={className}
        emptyContent={
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/60">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm">还没有消息</p>
            <p className="text-xs">发送第一条消息开始对话</p>
          </div>
        }
      />

      <MessageInput
        canSend={canSend}
        onSend={onSend}
        isLoading={false}
      />
    </div>
  );
}
