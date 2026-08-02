'use client';

import { useCallback, useMemo, useState } from 'react';
import { Send, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  formatMatrixEvent,
  useMatrixSendMessage,
  useMatrixThreadMessages,
  useMatrixEditMessage,
  useMatrixRedactMessage,
  type DisplayMessage,
} from '@/hooks/use-matrix';
import { MessageBubble } from '../views/MessageBubble';

interface ThreadPanelProps {
  roomId: string;
  rootMessage: DisplayMessage;
  memberMap?: Record<string, string>;
  onClose: () => void;
}

export function ThreadPanel({ roomId, rootMessage, memberMap, onClose }: ThreadPanelProps) {
  const { userId, isLoggedIn } = useMatrixStore();
  const [inputValue, setInputValue] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

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

  const replies = useMemo<DisplayMessage[]>(() => {
    const chunk = threadQuery.data?.chunk ?? [];
    const messages: DisplayMessage[] = [];
    for (const event of chunk) {
      const formatted = formatMatrixEvent(event, userId);
      if (formatted) messages.push(formatted);
    }
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }, [threadQuery.data, userId]);

  const rootSender = memberMap?.[rootMessage.sender] ?? rootMessage.senderShort;

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !isLoggedIn || sendMutation.isPending) return;
    sendMutation.mutate({
      roomId,
      body: trimmed,
      relatesTo: { rel_type: 'm.thread', event_id: rootMessage.id },
    });
    setInputValue('');
  }, [inputValue, isLoggedIn, sendMutation, roomId, rootMessage.id]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="w-80 shrink-0 border-l border-border bg-card overflow-hidden flex flex-col">
      {/* Header: thread title + root summary + close */}
      <div className="px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-xs">线程</h4>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose} title="关闭线程">
            <X className="w-3 h-3" />
          </Button>
        </div>
        <div className="mt-1.5 flex items-start gap-2 min-w-0">
          <Avatar className="w-5 h-5 shrink-0">
            <div className="w-full h-full rounded-full flex items-center justify-center text-[9px] font-medium bg-muted text-muted-foreground">
              {rootMessage.senderShort.slice(0, 2).toUpperCase()}
            </div>
          </Avatar>
          <p className="text-xs text-muted-foreground min-w-0">
            <span className="font-medium text-foreground">{rootSender}</span>
            <span className="block truncate">{rootMessage.content.slice(0, 80)}</span>
          </p>
        </div>
      </div>

      {/* Messages: root + thread replies */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {actionError && (
          <div className="px-3 py-1.5 text-[10px] text-red-500">{actionError}</div>
        )}
        <MessageBubble
          message={rootMessage}
          showSender
          isContinuation={false}
          onEdit={handleEdit}
          onDelete={handleDelete}
          memberMap={memberMap}
        />
        {threadQuery.isLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">加载线程回复...</div>
        ) : threadQuery.isError ? (
          <div className="px-3 py-2 flex flex-col items-start gap-1.5">
            <span className="text-xs text-red-500">线程加载失败</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => threadQuery.refetch()}>
              重试
            </Button>
          </div>
        ) : replies.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">暂无回复，成为第一个回复的人</div>
        ) : (
          replies.map((reply, idx) => {
            const prev = replies[idx - 1];
            const isContinuation = !!prev && prev.sender === reply.sender;
            return (
              <MessageBubble
                key={reply.id}
                message={reply}
                showSender={!isContinuation}
                isContinuation={isContinuation}
                onEdit={handleEdit}
                onDelete={handleDelete}
                memberMap={memberMap}
              />
            );
          })
        )}
        {sendMutation.isError && (
          <div className="px-3 py-1.5 text-[10px] text-red-500">发送失败: {sendMutation.error?.message}</div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border px-3 py-2 shrink-0 bg-card/20">
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLoggedIn ? '回复此线程... (Enter 发送, Shift+Enter 换行)' : '请先登录后再回复'}
          disabled={!isLoggedIn}
          rows={1}
          className="w-full resize-none rounded-lg border border-border bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 min-h-[36px] max-h-[120px] placeholder:text-muted-foreground/50 disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-muted-foreground">{replies.length} 条回复</span>
          <Button
            size="sm"
            className="h-7 px-2.5"
            onClick={handleSend}
            disabled={!inputValue.trim() || !isLoggedIn || sendMutation.isPending}
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
