'use client';

import { useCallback, useMemo, forwardRef } from 'react';
import { ScrollPanel, type ScrollPanelHandle } from './ScrollPanel';
import { buildGroupedMessages, type GroupedMessage } from '../grouper/MainGrouper';
import { EventTile } from '../views/EventTile';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { MessageSquare } from 'lucide-react';

interface MessageListProps {
  messages: DisplayMessage[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  loading: boolean;
  className?: string;
  _canSend: boolean;
  _onSend: (_content: string, _options?: { html?: boolean }, _mentions?: import('../chat-composer').MentionEntry[]) => void;
  onReply?: (message: DisplayMessage) => void;
  onCopy?: (message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
}

export const MessageList = forwardRef<ScrollPanelHandle, MessageListProps>(function MessageList(
  {
    messages,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
    loading,
    className,
    onReply,
    onCopy,
    memberMap,
  },
  ref
) {
  const grouped = useMemo(() => buildGroupedMessages(messages), [messages]);

  const itemContent = useCallback((_index: number, gm: GroupedMessage) => {
    if (!gm) return null;
    return (
      <EventTile
        key={gm.message.id}
        _message={gm.message}
        showSender={gm.showSender}
        isContinuation={gm.isContinuation}
        onReply={onReply}
        onCopy={onCopy}
        memberMap={memberMap}
      />
    );
  }, [onReply, onCopy, memberMap]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <ScrollPanel
        ref={ref}
        items={grouped}
        itemContent={itemContent}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={onLoadMore}
        loading={loading}
        emptyContent={
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm">还没有消息</p>
            <p className="text-xs">发送第一条消息开始对话</p>
          </div>
        }
      />
    </div>
  );
});
