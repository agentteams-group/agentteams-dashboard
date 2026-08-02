'use client';

import { useCallback, useMemo, forwardRef } from 'react';
import { TimelinePanel } from './TimelinePanel';
import type { ScrollPanelHandle } from './ScrollPanel';
import { buildGroupedMessages, type GroupedMessage } from '../grouper/MainGrouper';
import { EventTile } from '../views/EventTile';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { MessageSquare } from 'lucide-react';

/**
 * Locally tracked outbound message while it is still in flight or failed.
 * Rendered below the virtual timeline without disturbing read markers or
 * grouping of the server-backed messages.
 */
export interface LocalOutboundMessage {
  clientId: string;
  sender: string;
  senderShort: string;
  content: string;
  formattedContent?: string;
  timestamp: number;
  status: 'sending' | 'error';
  error?: string;
  /** Retained so a failed send can be replayed with its original mentions. */
  mentions?: import('../chat-composer').MentionEntry[];
  /** Retained so a failed reply can be replayed with its m.in_reply_to target. */
  replyTo?: DisplayMessage | null;
}

export function toLocalDisplayMessage(local: LocalOutboundMessage): DisplayMessage {
  return {
    id: local.clientId,
    sender: local.sender,
    senderShort: local.senderShort,
    content: local.content,
    formattedContent: local.formattedContent,
    timestamp: local.timestamp,
    type: 'm.text',
    isMe: true,
    status: local.status,
  };
}

interface MessageListProps {
  messages: DisplayMessage[];
  /** Locally tracked outbound messages (sending/failed) shown above the composer. */
  localMessages?: LocalOutboundMessage[];
  /** Id of the last read message; a read marker line is rendered after it. */
  readEventId?: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  loading: boolean;
  className?: string;
  _canSend: boolean;
  _onSend: (_content: string, _options?: { html?: boolean }, _mentions?: import('../chat-composer').MentionEntry[]) => void;
  onReply?: (_message: DisplayMessage) => void;
  onCopy?: (_message: DisplayMessage) => void;
  onOpenThread?: (_message: DisplayMessage) => void;
  onEdit?: (_message: DisplayMessage, _newContent: string) => Promise<void> | void;
  onDelete?: (_message: DisplayMessage) => void;
  onResend?: (_message: DisplayMessage) => void;
  onCancel?: (_message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
  /** Called whenever the scroller enters or leaves the bottom position. */
  onAtBottomChange?: (_atBottom: boolean) => void;
}

export const MessageList = forwardRef<ScrollPanelHandle, MessageListProps>(function MessageList(
  {
    messages,
    localMessages = [],
    readEventId,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
    loading,
    className,
    onReply,
    onCopy,
    onOpenThread,
    onEdit,
    onDelete,
    onResend,
    onCancel,
    memberMap,
    onAtBottomChange,
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
        onOpenThread={onOpenThread}
        onEdit={onEdit}
        onDelete={onDelete}
        onResend={onResend}
        onCancel={onCancel}
        memberMap={memberMap}
      />
    );
  }, [onReply, onCopy, onOpenThread, onEdit, onDelete, onResend, onCancel, memberMap]);

  // Top-edge pagination status: older messages are prepended at the top, so
  // the spinner/button lives at the top instead of the footer (where it would
  // fight with the latest messages at the bottom).
  const header = useMemo(() => {
    if (isFetchingNextPage) {
      return (
        <div className="flex justify-center py-2">
          <span className="text-xs text-muted-foreground animate-pulse">正在加载更早的消息...</span>
        </div>
      );
    }
    if (hasNextPage) {
      return (
        <div className="flex justify-center py-2">
          <button
            onClick={onLoadMore}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            加载更早消息
          </button>
        </div>
      );
    }
    if (grouped.length > 0) {
      return (
        <div className="flex justify-center py-2">
          <span className="text-[10px] text-muted-foreground/60">已经到最早的消息了</span>
        </div>
      );
    }
    return <div />;
  }, [isFetchingNextPage, hasNextPage, grouped.length, onLoadMore]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {header}
      <TimelinePanel
        ref={ref}
        items={grouped}
        readEventId={readEventId}
        itemContent={itemContent}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={onLoadMore}
        loading={loading}
        onAtBottomChange={onAtBottomChange}
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
      {/* Locally tracked outbound messages (sending / failed) sit above the
          composer, outside the virtual list so they never fight with read
          markers or pagination. */}
      {localMessages.length > 0 && (
        <div className="shrink-0 border-t border-border/40 bg-background/40">
          {localMessages.map((local) => (
            <EventTile
              key={local.clientId}
              _message={toLocalDisplayMessage(local)}
              showSender
              isContinuation={false}
              onDelete={onDelete}
              onResend={onResend}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
});
