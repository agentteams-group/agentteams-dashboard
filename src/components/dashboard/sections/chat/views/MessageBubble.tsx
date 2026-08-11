'use client';

import { useCallback, useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { isMessageReadByOthers, type ReadReceiptEntry } from '@/hooks/use-matrix';
import { MarkdownMessage } from '../markdown-message';
import { ConfirmationCard, type ConfirmationCardPayload } from '../confirmation-card';
import { StreamingCard } from '../streaming-card';
import { ThinkingCard } from '../thinking-card';
import { A2uiMessage } from '../a2ui-message';
import { WorkflowCard } from './workflow-card';
import { ToolCallView, type ToolCallPayload } from './toolcalls';
import { normalizeToBlocks } from '@/lib/a2ui/normalize';
import type { ParsedA2uiBlock, AttachmentPayload } from '@/lib/a2ui/parser';
import { AttachmentCard } from '../attachment-card';
import { Check, CheckCheck, Loader2 } from 'lucide-react';

interface MessageBubbleProps {
  message: DisplayMessage;
  showSender: boolean;
  isContinuation: boolean;
  onReply?: (_message: DisplayMessage) => void;
  onCopy?: (_message: DisplayMessage) => void;
  onOpenThread?: (_message: DisplayMessage) => void;
  onEdit?: (_message: DisplayMessage, _newContent: string) => Promise<void> | void;
  onDelete?: (_message: DisplayMessage) => void;
  onResend?: (_message: DisplayMessage) => void;
  onCancel?: (_message: DisplayMessage) => void;
  onSendConfirmation?: (_content: string) => void;
  onOpenWorkerFiles?: () => void;
  senderShort?: string;
  memberMap?: Record<string, string>;
  /** Latest m.read receipts of every user in the room (for ✓✓ read indicator). */
  readReceipts?: Record<string, ReadReceiptEntry>;
  currentUserId?: string | null;
}

function MessageTime({ timestamp }: { timestamp: number }) {
  const time = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <span className="text-[10px] text-muted-foreground/60 select-none">
      {time}
    </span>
  );
}

function AvatarWithInitials({ senderShort, isMe }: { senderShort: string; isMe: boolean }) {
  return (
    <Avatar className="w-7 h-7 shrink-0">
      <div className={`w-full h-full rounded-full flex items-center justify-center text-xs font-medium ${
        isMe
          ? 'bg-primary/20 text-primary'
          : 'bg-muted text-muted-foreground'
      }`}>
        {senderShort.slice(0, 2).toUpperCase()}
      </div>
    </Avatar>
  );
}

function ActionIcon({ path, size = 12, label }: { path: string; size?: number; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label={label}>
      <path d={path} />
    </svg>
  );
}

  const ICON_PATHS = {
  reply: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  copy: 'M9 9h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  thread: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  edit: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z',
  cancel: 'M6 6l12 12M18 6L6 18',
  resend: 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
};

function ActionButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: string;
  onClick: (_e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className="opacity-0 group-hover/message:opacity-100 text-muted-foreground hover:text-foreground transition-opacity p-1"
      title={title}
      aria-label={title}
    >
      <ActionIcon path={icon} label={title} />
    </button>
  );
}

export function MessageBubble({
  message,
  showSender,
  isContinuation,
  onReply,
  onCopy,
  onOpenThread,
  onEdit,
  onDelete,
  onResend,
  onCancel,
  onSendConfirmation,
  onOpenWorkerFiles,
  senderShort,
  memberMap,
  readReceipts,
  currentUserId,
}: MessageBubbleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const showAvatar = !isContinuation && showSender;

  const parsedBlocks = useMemo<ParsedA2uiBlock[]>(() => {
    return normalizeToBlocks({
      body: message.content,
      formattedBody: message.formattedContent || undefined,
      content: message.rawContent ?? {},
      isStreaming: !!message.isStreaming,
      isMine: message.isMe,
    });
  }, [message.content, message.formattedContent, message.rawContent, message.isStreaming, message.isMe]);

  const handleConfirmationApprove = useCallback((reply: string) => {
    if (!onSendConfirmation) return;
    onSendConfirmation(reply);
  }, [onSendConfirmation]);

  const handleConfirmationReject = useCallback((reply: string) => {
    if (!onSendConfirmation) return;
    onSendConfirmation(reply);
  }, [onSendConfirmation]);
  const actionsVisible = isHovered || showActions;

  // element-web style delivery state for my own messages:
  // sending → spinner, sent → single ✓, read by another member → double ✓✓.
  const isReadByOthers =
    message.isMe && !message.status && !!readReceipts
      ? isMessageReadByOthers(message, currentUserId, readReceipts)
      : false;

  // Agent run status badge (org.agentteams.status). Only shown on other
  // members' messages (agent runs), not for the user's own bubbles.
  const agentStatusBadge = (() => {
    if (message.isMe || !message.agentStatus) return null;
    const status = message.agentStatus;
    if (status === 'streaming' || status === 'in_progress' || status === 'running') {
      return { label: '运行中', className: 'bg-sky-500/15 text-sky-600' };
    }
    if (status === 'success' || status === 'completed' || status === 'done') {
      return { label: '已完成', className: 'bg-emerald-500/15 text-emerald-600' };
    }
    if (status === 'failed' || status === 'error') {
      return { label: '失败', className: 'bg-red-500/15 text-red-600' };
    }
    return { label: status, className: 'bg-muted text-muted-foreground' };
  })();

  const startEdit = useCallback(() => {
    setEditValue(message.content);
    setEditError(null);
    setIsEditing(true);
    setShowActions(false);
  }, [message.content]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditError(null);
  }, []);

  const submitEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || !onEdit) return;
    try {
      await onEdit(message, trimmed);
      setIsEditing(false);
      setEditError(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '编辑失败');
    }
  }, [editValue, message, onEdit]);

  const bubbleClasses = [
    'w-fit max-w-[min(92%,72ch)] px-3 py-1.5 rounded-2xl text-sm break-words',
    message.isMe
      ? 'bg-primary text-primary-foreground rounded-tr-sm'
      : 'bg-muted text-foreground rounded-tl-sm',
    message.status === 'error' ? 'ring-1 ring-red-400/70' : '',
    message.status === 'sending' ? 'opacity-70' : '',
  ].join(' ');

  return (
    <div
      className={`flex gap-2 px-3 py-0.5 group/message ${!isContinuation ? 'mt-2' : ''} ${message.isMe ? 'flex-row-reverse' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        // Mobile: tap the message to toggle the action bar (desktop uses hover).
        setShowActions(v => !v);
      }}
    >
      {/* Avatar column: mirrors the bubble side (own messages on the right). */}
      <div className="w-7 shrink-0">
        {showAvatar && (
          <AvatarWithInitials senderShort={message.senderShort} isMe={message.isMe} />
        )}
      </div>

      <div className={`flex-1 min-w-0 flex flex-col ${message.isMe ? 'items-end' : 'items-start'}`}>
        {showAvatar && (
          <div className={`flex items-center gap-1.5 mb-0.5 ${message.isMe ? 'flex-row-reverse' : ''}`}>
            <span className={`text-xs font-medium ${message.isMe ? 'text-primary' : 'text-foreground'}`}>
              {message.senderShort}
            </span>
            {message.isStreaming && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                <span className="animate-pulse">streaming</span>
              </Badge>
            )}
            {agentStatusBadge && !message.isStreaming && (
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${agentStatusBadge.className}`}>
                {agentStatusBadge.label}
              </span>
            )}
            {message.isEdited && (
              <span className="text-[10px] text-muted-foreground italic">(edited)</span>
            )}
            {message.status === 'sending' && (
              <span className="text-[10px] text-muted-foreground italic">发送中...</span>
            )}
            {message.status === 'error' && (
              <span className="text-[10px] text-red-500 italic">发送失败</span>
            )}
          </div>
        )}

        <div className={`flex items-end gap-2 ${message.isMe ? 'flex-row-reverse' : ''}`}>
          {isEditing ? (
            <div className={`w-full ${message.isMe ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitEdit();
                  }
                  if (e.key === 'Escape') cancelEdit();
                }}
                autoFocus
                rows={2}
                className="w-full min-w-[280px] resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              />
              {editError && (
                <span className="text-[10px] text-red-500">{editError}</span>
              )}
              <div className="flex items-center gap-1.5">
                <Button size="sm" className="h-6 px-2 text-xs" onClick={submitEdit}>
                  保存
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={cancelEdit}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <div className={`flex w-full min-w-0 flex-col gap-1.5 ${message.isMe ? 'items-end' : 'items-start'}`}>
              {parsedBlocks.map((block, idx) => {
                if (block.type === 'confirmation' && onSendConfirmation) {
                  return (
                    <div key={idx} className="w-[min(100%,56rem)] max-w-full">
                      <ConfirmationCard
                        payload={block.payload as unknown as ConfirmationCardPayload}
                        onApprove={handleConfirmationApprove}
                        onReject={handleConfirmationReject}
                      />
                    </div>
                  );
                }
                if (block.type === 'tool_call') {
                  return <div key={idx} className="w-[min(100%,56rem)] max-w-full"><ToolCallView payload={block.payload as ToolCallPayload} /></div>;
                }
                if (block.type === 'workflow') {
                  return <WorkflowCard key={idx} payload={block.payload as import('@/lib/a2ui/workflow').WorkflowPayload} />;
                }
                if (block.type === 'thinking') {
                  return <div key={idx} className="w-[min(100%,56rem)] max-w-full"><ThinkingCard content={block.content || ''} isStreaming={block.isStreaming ?? message.isStreaming} /></div>;
                }
                if (block.type === 'card') {
                  return <div key={idx} className="w-[min(100%,56rem)] max-w-full"><StreamingCard payload={block.payload as Record<string, unknown>} /></div>;
                }
                if (block.type === 'a2ui' && block.isStreaming) {
                  return (
                    <div key={idx} className="w-[min(100%,56rem)] max-w-full rounded-xl border border-border/60 bg-card/70 px-3 py-1 shadow-sm">
                      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>正在生成交互内容...</span>
                      </div>
                    </div>
                  );
                }
                if (block.type === 'a2ui' && block.messages) {
                  return <div key={idx} className="w-[min(100%,56rem)] max-w-full rounded-xl border border-border/60 bg-card/70 px-3 py-1 shadow-sm"><A2uiMessage messages={block.messages} /></div>;
                }
                if (block.type === 'attachment' && block.payload) {
                  return (
                    <div key={idx} className="w-[min(100%,56rem)] max-w-full">
                      <AttachmentCard payload={block.payload as unknown as AttachmentPayload} />
                    </div>
                  );
                }
                if (block.type === 'text' && block.text) {
                  return (
                    <div key={idx} className={bubbleClasses}>
                      <MarkdownMessage
                        content={block.text}
                        formattedContent={message.formattedContent ? block.text : undefined}
                        msgType={message.type}
                        mediaUrl={message.mediaUrl}
                        mediaInfo={message.mediaInfo}
                        memberMap={memberMap}
                        isStreaming={message.isStreaming}
                      />
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}

          <div className={`flex items-center gap-1 text-[10px] ${
            isContinuation && !isHovered && !showActions ? 'opacity-0 group-hover/message:opacity-100' : ''
          }`}>
            <MessageTime timestamp={message.timestamp} />
            {/* element-web style delivery ticks for my own messages */}
            {message.isMe && message.status === 'sending' && (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" aria-label="发送中" />
            )}
            {message.isMe && message.status === 'error' && (
              <span className="text-red-500 font-medium" title="发送失败">!</span>
            )}
            {message.isMe && !message.status && (
              isReadByOthers ? (
                <CheckCheck className="w-3.5 h-3.5 text-emerald-500" aria-label="已读" />
              ) : (
                <Check className="w-3.5 h-3.5 text-muted-foreground" aria-label="已发送" />
              )
            )}
          </div>
        </div>

        {message.replyCount && message.replyCount > 0 && onOpenThread && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenThread(message);
            }}
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            title="在线程中查看回复"
          >
            <span>↩</span>
            {message.replyCount} 条回复
          </button>
        )}

        {actionsVisible && (
          <div
            className={`flex gap-1 mt-1 ${message.isMe ? 'justify-end' : 'justify-start'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {message.status === 'sending' && onCancel && (
              <ActionButton title="取消发送" icon={ICON_PATHS.cancel} onClick={() => onCancel(message)} />
            )}
            {message.status === 'error' && onResend && (
              <ActionButton title="重新发送" icon={ICON_PATHS.resend} onClick={() => onResend(message)} />
            )}
            {message.status === 'error' && onDelete && (
              <ActionButton title="移除" icon={ICON_PATHS.trash} onClick={() => onDelete(message)} />
            )}
            {message.isMe && !message.status && onEdit && (
              <ActionButton title="编辑" icon={ICON_PATHS.edit} onClick={startEdit} />
            )}
            {message.isMe && !message.status && onDelete && (
              <ActionButton title="删除" icon={ICON_PATHS.trash} onClick={() => onDelete(message)} />
            )}
            {onReply && (
              <ActionButton title="回复" icon={ICON_PATHS.reply} onClick={() => onReply(message)} />
            )}
            {onOpenThread && (
              <ActionButton title="在线程中回复" icon={ICON_PATHS.thread} onClick={() => onOpenThread(message)} />
            )}
            {onCopy && (
              <ActionButton title="复制" icon={ICON_PATHS.copy} onClick={() => onCopy(message)} />
            )}
            {onOpenWorkerFiles && !message.isMe && senderShort && (
              <ActionButton title="查看工作目录" icon={ICON_PATHS.folder} onClick={onOpenWorkerFiles} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
