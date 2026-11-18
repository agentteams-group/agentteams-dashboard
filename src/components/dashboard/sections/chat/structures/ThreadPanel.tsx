'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  formatMatrixEvents,
  useMatrixSendMessage,
  useMatrixThreadMessages,
  useMatrixEditMessage,
  useMatrixRedactMessage,
  type DisplayMessage,
} from '@/hooks/use-matrix';
import { MessageBubble } from '../views/MessageBubble';
import { useImeGuard } from '../use-ime-guard';
import { buildAnswerContent, buildConfirmationReply, type ConfirmationAnswerField } from '../confirmation-reply';
import { ComposerReply, ReplyQuote } from '../views/ReplyQuote';
import { coalesceWorkerTurns } from '../grouper/AgentTurnGrouper';
import { useRuntimeMap } from '../runtime-map-context';
import { isManagerSender } from '@/lib/chat-lifecycle-notice';

interface ThreadPanelProps {
  canSend?: boolean;
  roomId: string;
  rootMessage: DisplayMessage;
  focusedMessage?: DisplayMessage | null;
  quotedReplies?: DisplayMessage[];
  onBack: () => void;
  memberMap?: Record<string, string>;
  workerMatrixUserIds?: string[];
}

/** 话题 body（无面板外框）：根消息 + Matrix m.thread 回复 + 回复框。 */
export function ThreadPanel({
  canSend = true,
  roomId,
  rootMessage,
  focusedMessage,
  quotedReplies,
  onBack,
  memberMap,
  workerMatrixUserIds,
}: ThreadPanelProps) {
  const { userId, isLoggedIn } = useMatrixStore();
  const runtimeMap = useRuntimeMap();
  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { isImeKey, onCompositionStart, onCompositionEnd } = useImeGuard();
  const [actionError, setActionError] = useState<string | null>(null);
  const focusedRef = useRef<HTMLDivElement>(null);

  const threadQuery = useMatrixThreadMessages(roomId, rootMessage.id);
  const sendMutation = useMatrixSendMessage();
  const editMutation = useMatrixEditMessage();
  const redactMutation = useMatrixRedactMessage();

  const handleEdit = useCallback(async (message: DisplayMessage, newContent: string) => {
    if (!message.isMe) return;
    setActionError(null);
    await editMutation.mutateAsync({
      roomId,
      eventId: message.eventId || message.id,
      body: newContent,
    });
  }, [roomId, editMutation]);

  const handleDelete = useCallback((message: DisplayMessage) => {
    if (!message.isMe) return;
    if (!window.confirm('确定删除这条消息吗？此操作不可撤销。')) return;
    setActionError(null);
    redactMutation.mutate(
      { roomId, eventId: message.eventId || message.id },
      { onError: (err) => setActionError(err.message) }
    );
  }, [roomId, redactMutation]);

  const replies = useMemo(() => {
    const rootIds = new Set([rootMessage.id, rootMessage.eventId, ...(rootMessage.sourceEventIds ?? [])]);
    const messages = new Map(quotedReplies?.map(message => [message.id, message]));
    for (const message of formatMatrixEvents(threadQuery.data?.chunk ?? [], userId, { includeThreadReplies: true })) {
      if (rootIds.has(message.id)) continue;
      const owner = runtimeMap[message.sender];
      messages.set(message.id, {
        ...message,
        runtime: owner?.runtime,
        workerName: owner?.workerName ?? (
          workerMatrixUserIds?.includes(message.sender) || isManagerSender(message.sender) ? message.senderShort : undefined
        ),
      });
    }
    if (focusedMessage && !messages.has(focusedMessage.id) && !rootIds.has(focusedMessage.id)) {
      messages.set(focusedMessage.id, focusedMessage);
    }
    return coalesceWorkerTurns(
      Array.from(messages.values()).sort((a, b) => a.timestamp - b.timestamp),
      { topic: true },
    );
  }, [threadQuery.data, userId, rootMessage, focusedMessage, quotedReplies, runtimeMap, workerMatrixUserIds]);

  useEffect(() => {
    focusedRef.current?.scrollIntoView?.({ block: 'center' });
  }, [focusedMessage?.id, threadQuery.isLoading]);

  const selectReply = (message: DisplayMessage) => {
    setReplyTo(message);
    inputRef.current?.focus({ preventScroll: true });
  };
  const replyQuote = (message: DisplayMessage) => {
    const eventId = message.replyToEventId;
    if (!eventId) return null;
    const target = [rootMessage, ...replies].find(item => item.id === eventId || item.eventId === eventId || item.sourceEventIds?.includes(eventId));
    return <ReplyQuote roomId={roomId} eventId={eventId} target={target} memberMap={memberMap} />;
  };

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!canSend || !trimmed || !isLoggedIn || sendMutation.isPending) return;
    sendMutation.mutate({
      roomId,
      body: trimmed,
      relatesTo: {
        rel_type: 'm.thread', event_id: rootMessage.id,
        ...(replyTo ? { 'm.in_reply_to': { event_id: replyTo.eventId || replyTo.id } } : {}),
      },
    }, { onSuccess: () => setReplyTo(null) });
    setInputValue('');
  }, [inputValue, isLoggedIn, sendMutation, roomId, rootMessage.id, canSend, replyTo]);

  const handleSendConfirmation = useCallback((content: string, sender?: string, _eventId?: string, answer?: ConfirmationAnswerField): Promise<boolean> => {
    if (!isLoggedIn || sendMutation.isPending) return Promise.resolve(false);
    const reply = buildConfirmationReply(content, sender, workerMatrixUserIds);
    let formattedBody: string | undefined;
    if (reply.mentions?.length) {
      formattedBody = reply.content;
      for (const mention of reply.mentions) {
        const link = `<a href="https://matrix.to/#/${encodeURIComponent(mention.userId)}">${mention.displayName}</a>`;
        formattedBody = formattedBody.replaceAll(mention.placeholder, link);
      }
    }
    return new Promise<boolean>((resolve) => {
      sendMutation.mutate({
        roomId,
        body: reply.content,
        formattedBody,
        extra: buildAnswerContent(answer),
        mentions: reply.mentions?.length
          ? { user_ids: reply.mentions.map((mention) => mention.userId) }
          : undefined,
        relatesTo: { rel_type: 'm.thread', event_id: rootMessage.id },
      }, {
        onSuccess: () => resolve(true),
        onError: () => resolve(false),
      });
    });
  }, [isLoggedIn, sendMutation, roomId, rootMessage.id, workerMatrixUserIds]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, isImeKey]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-2 py-1">
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs"
          aria-label="返回话题列表" onClick={onBack}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          返回话题列表
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 custom-scrollbar">
        {actionError && (
          <div className="px-3 py-1.5 text-xs text-red-500">{actionError}</div>
        )}
        <MessageBubble
          message={rootMessage}
          showSender
          isContinuation={false}
          replyQuote={replyQuote(rootMessage)}
          onReply={canSend && isLoggedIn ? selectReply : undefined}
          onEdit={canSend ? handleEdit : undefined}
          onDelete={canSend ? handleDelete : undefined}
          onSendConfirmation={canSend ? handleSendConfirmation : undefined}
          memberMap={memberMap}
        />
        {threadQuery.isLoading && (
          <div className="px-3 py-2 text-xs text-muted-foreground">加载话题回复...</div>
        )}
        {threadQuery.isError && (
          <div className="px-3 py-2 flex flex-col items-start gap-1.5">
            <span className="text-xs text-red-500">话题加载失败</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => threadQuery.refetch()}>
              重试
            </Button>
          </div>
        )}
        {replies.length === 0 && !threadQuery.isLoading && !threadQuery.isError && (
          <div className="px-3 py-2 text-xs text-muted-foreground">暂无回复，成为第一个回复的人</div>
        )}
        {replies.map((reply, idx) => {
          const prev = replies[idx - 1];
          const isContinuation = !!prev && prev.sender === reply.sender;
          const focused = !!focusedMessage && (reply.id === focusedMessage.id || reply.sourceEventIds?.includes(focusedMessage.id));
          return (
            <div key={reply.id} ref={focused ? focusedRef : undefined}
              className={focused ? 'rounded-lg bg-blue-500/5 ring-1 ring-blue-500/30' : undefined}>
              <MessageBubble
                message={reply}
                showSender={!isContinuation}
                isContinuation={isContinuation}
                replyQuote={replyQuote(reply)}
                onReply={canSend && isLoggedIn ? selectReply : undefined}
                onEdit={canSend ? handleEdit : undefined}
                onDelete={canSend ? handleDelete : undefined}
                onSendConfirmation={canSend ? handleSendConfirmation : undefined}
                memberMap={memberMap}
              />
            </div>
          );
        })}
        {sendMutation.isError && (
          <div className="px-3 py-1.5 text-xs text-red-500">发送失败: {sendMutation.error?.message}</div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border px-3 py-2 shrink-0 bg-card/20">
        {replyTo && <ComposerReply target={replyTo} memberMap={memberMap} onCancel={() => setReplyTo(null)} />}
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={isLoggedIn ? '回复此话题... (Enter 发送, Shift+Enter 换行)' : '请先登录后再回复'}
          disabled={!canSend || !isLoggedIn}
          rows={1}
          className="w-full resize-none rounded-lg border border-border bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px] max-h-[120px] placeholder:text-muted-foreground/50 disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-muted-foreground">{replies.length} 条回复</span>
          <Button
            size="sm"
            className="h-7 px-2.5"
            onClick={handleSend}
            disabled={!canSend || !inputValue.trim() || !isLoggedIn || sendMutation.isPending}
          >
            {sendMutation.isPending ? (
              <span className="animate-pulse">发送中</span>
            ) : (
              <>
                <Send className="w-3 h-3 mr-1" />
                发送
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
