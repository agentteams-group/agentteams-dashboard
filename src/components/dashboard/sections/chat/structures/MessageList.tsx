'use client';

import { useCallback, useEffect, useMemo, useState, forwardRef } from 'react';
import { TimelinePanel } from './TimelinePanel';
import type { ScrollPanelHandle } from './ScrollPanel';
import { buildGroupedMessages, type GroupedMessage } from '../grouper/MainGrouper';
import { EventTile } from '../views/EventTile';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { MessageSquare, AlertTriangle, RotateCcw, X } from 'lucide-react';
import type { MentionEntry } from '../chat-composer';

/**
 * System notice rendered inline in the message stream (rate-limit / send
 * failure). Carries an optional retry payload so the user can replay the
 * failed send, and an optional auto-retry countdown for rate limits.
 */
export interface ChatSystemNotice {
  id: number;
  kind: 'rate-limited' | 'error';
  message: string;
  createdAt: number;
  /** Rate limits: when an auto-retry is scheduled to fire. */
  retryAfterMs?: number;
  autoRetry: boolean;
  retryPayload?: { content: string; mentions?: MentionEntry[]; replyTo?: DisplayMessage | null };
}

function SystemNoticeItem({
  notice,
  onRetry,
  onDismiss,
}: {
  notice: ChatSystemNotice;
  onRetry: (_notice: ChatSystemNotice) => void;
  onDismiss: (_notice: ChatSystemNotice) => void;
}) {
  const [leftMs, setLeftMs] = useState(() =>
    notice.autoRetry && notice.retryAfterMs ? notice.retryAfterMs : 0
  );

  useEffect(() => {
    if (!notice.autoRetry || !notice.retryAfterMs) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const remaining = notice.retryAfterMs! - (Date.now() - start);
      if (remaining <= 0) {
        clearInterval(timer);
        onRetry(notice);
        return;
      }
      setLeftMs(remaining);
    }, 250);
    return () => clearInterval(timer);
  }, [notice, onRetry]);

  const seconds = Math.max(1, Math.ceil(leftMs / 1000));

  return (
    <div className="flex items-center justify-center px-4 py-1.5">
      <div
        className={`flex items-center gap-2 max-w-[92%] rounded-lg border px-3 py-1.5 text-xs ${
          notice.kind === 'rate-limited'
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700'
            : 'border-red-500/40 bg-red-500/10 text-red-600'
        }`}
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{notice.message}</span>
        {notice.kind === 'rate-limited' && notice.autoRetry && (
          <span className="shrink-0 font-mono opacity-80">{seconds}s</span>
        )}
        <button
          onClick={() => onRetry(notice)}
          className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-foreground/10 transition-colors"
          title="重新发送"
        >
          <RotateCcw className="w-3 h-3" />
          重试
        </button>
        <button
          onClick={() => onDismiss(notice)}
          className="shrink-0 rounded p-0.5 hover:bg-foreground/10 transition-colors"
          title="关闭"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

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
  onSendConfirmation?: (_content: string) => void;
  memberMap?: Record<string, string>;
  /** Called whenever the scroller enters or leaves the bottom position. */
  onAtBottomChange?: (_atBottom: boolean) => void;
  /** System notices (rate-limit / send failures) rendered in the stream. */
  notices?: ChatSystemNotice[];
  onRetryNotice?: (_notice: ChatSystemNotice) => void;
  onDismissNotice?: (_notice: ChatSystemNotice) => void;
  /** Latest m.read receipts of every user in the room (for ✓✓ read indicator). */
  readReceipts?: Record<string, import('@/hooks/use-matrix').ReadReceiptEntry>;
  currentUserId?: string | null;
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
    onSendConfirmation,
    memberMap,
    onAtBottomChange,
    notices = [],
    onRetryNotice,
    onDismissNotice,
    readReceipts,
    currentUserId,
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
        onSendConfirmation={onSendConfirmation}
        memberMap={memberMap}
        readReceipts={readReceipts}
        currentUserId={currentUserId}
      />
    );
  }, [onReply, onCopy, onOpenThread, onEdit, onDelete, onResend, onCancel, onSendConfirmation, memberMap, readReceipts, currentUserId]);

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
      {/* System notices (rate-limit / send failures) sit at the end of the
          message stream, above the composer, so they read as conversation
          entries while keeping the virtual list untouched. */}
      {notices.length > 0 && (
        <div className="shrink-0">
          {notices.map((notice) => (
            <SystemNoticeItem
              key={notice.id}
              notice={notice}
              onRetry={onRetryNotice ?? (() => {})}
              onDismiss={onDismissNotice ?? (() => {})}
            />
          ))}
        </div>
      )}
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
