'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { isMessageReadByOthers, type ReadReceiptEntry } from '@/hooks/use-matrix';
import { MarkdownMessage } from '../markdown-message';
import { ConfirmationCard, type ConfirmationCardPayload } from '../confirmation-card';
import { InterventionCard } from '../intervention-card';
import { ReviewReportCard } from '../review-report-card';
import { isInterventionConfirmation, type RuntimeConfirmationBlock } from '@/lib/a2ui/protocol';
import {
  isManagerSender,
  parseWorkerLifecycleNotice,
  type WorkerLifecycleNotice,
} from '@/lib/chat-lifecycle-notice';
import { StreamingCard } from '../streaming-card';
import { ThinkingCard } from '../thinking-card';
import { A2uiMessage } from '../a2ui-message';
import { RunEndingNote, type RunEndingPayload } from '../run-ending-note';
import { WorkflowCard } from './workflow-card';
import { ToolCallView, type ToolCallPayload } from './toolcalls';
import { RunProcessDisclosure, isProcessBlock } from './run-process-disclosure';
import { normalizeToBlocks } from '@/lib/a2ui/normalize';
import {
  heuristicToInterventionPayload,
  parseInterventionHeuristic,
} from '@/lib/a2ui/intervention-heuristic';
import type { ParsedA2uiBlock, AttachmentPayload } from '@/lib/a2ui/parser';
import { AttachmentCard } from '../attachment-card';
import { FileRefChips } from './file-ref-chips';
import { recordToolCalls } from '@/lib/tool-call-counter';
import { Check, CheckCheck, CircleSlash, Copy, Link2, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { RuntimeBadge } from '@/components/dashboard/phase-badge';
import type { WorkerSessionState } from '@/lib/worker-session-state';
import { WorkerSessionCornerDot } from '@/components/worker-session-dot';

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
  onSendConfirmation?: (_content: string, _sender?: string, _eventId?: string) => void;
  /** Opens the owning worker's files panel (team rooms: multi-worker source). */
  onOpenWorkerFiles?: (_message: DisplayMessage) => void;
  /**
   * Opens the owning worker's read-only QwenPaw sessions (C / #1295).
   * Only worker senders get a clickable avatar; humans do not.
   */
  onOpenWorkerChats?: (_workerName: string) => void;
  senderShort?: string;
  memberMap?: Record<string, string>;
  /** Latest m.read receipts of every user in the room (for ✓✓ read indicator). */
  readReceipts?: Record<string, ReadReceiptEntry>;
  currentUserId?: string | null;
  /**
   * Live session state of the sender, when the sender is a worker (A17
   * status dot on the avatar). Undefined for humans / unknown senders.
   */
  senderStatus?: WorkerSessionState | null;
}

/**
 * ChatIR turn states that need a visible explanation: a detached thread, a
 * run that never produced an answer, and a run that just opened.
 */
function TurnStateNote({
  state,
  hasBlocks,
}: {
  state: DisplayMessage['turnState'];
  hasBlocks: boolean;
}) {
  if (state === 'detached') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70" data-turn-state="detached">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
        原消息不在当前加载范围，以下为该话题中的回复
      </p>
    );
  }
  if (state === 'interrupted') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400" data-turn-state="interrupted">
        <CircleSlash className="h-3 w-3 shrink-0" aria-hidden="true" />
        本轮未生成最终答复
      </p>
    );
  }
  if (state === 'pending' && !hasBlocks) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-turn-state="pending">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        等待回复…
      </p>
    );
  }
  return null;
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

/**
 * Controller lifecycle announcements (worker container paused / resumed) are
 * status, not conversation: show a compact centered notice instead of a
 * sender bubble, while keeping the original text in the hover title.
 */
function LifecycleNoticeRow({
  notice,
  timestamp,
}: {
  notice: WorkerLifecycleNotice;
  timestamp: number;
}) {
  const Icon = notice.kind === 'paused' ? PauseCircle : PlayCircle;
  const label =
    notice.kind === 'paused'
      ? '已自动暂停，指派任务后将自动恢复'
      : '已自动恢复';
  return (
    <div className="flex justify-center py-1" data-lifecycle-notice={notice.kind}>
      <div
        role="status"
        title={notice.body}
        className="flex max-w-[92%] items-start gap-1.5 rounded-md border border-border/40 bg-muted/30 px-2.5 py-1 text-[11px] leading-relaxed text-muted-foreground"
      >
        <Icon className="mt-[1px] h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">
          <span className="font-medium text-foreground/80">Worker {notice.worker}</span>{' '}
          {label}
        </span>
        <MessageTime timestamp={timestamp} />
      </div>
    </div>
  );
}

// Stable per-sender palette so different workers in a team room are visually
// distinguishable at a glance (avatar + sender name share the same tone).
const SENDER_PALETTE = [
  { avatar: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', name: 'text-sky-600 dark:text-sky-400' },
  { avatar: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', name: 'text-violet-600 dark:text-violet-400' },
  { avatar: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', name: 'text-amber-600 dark:text-amber-400' },
  { avatar: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', name: 'text-rose-600 dark:text-rose-400' },
  { avatar: 'bg-teal-500/15 text-teal-700 dark:text-teal-300', name: 'text-teal-600 dark:text-teal-400' },
  { avatar: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300', name: 'text-indigo-600 dark:text-indigo-400' },
  { avatar: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', name: 'text-orange-600 dark:text-orange-400' },
  { avatar: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300', name: 'text-cyan-600 dark:text-cyan-400' },
];

function senderPaletteIndex(sender: string): number {
  let hash = 0;
  for (let i = 0; i < sender.length; i++) {
    hash = (hash * 31 + sender.charCodeAt(i)) >>> 0;
  }
  return hash % SENDER_PALETTE.length;
}

function senderPalette(sender: string) {
  return SENDER_PALETTE[senderPaletteIndex(sender)];
}

function AvatarWithInitials({ sender, label, isMe }: { sender: string; label: string; isMe: boolean }) {
  const palette = senderPalette(sender);
  return (
    <Avatar className="h-[30px] w-[30px] shrink-0 rounded-[9px]">
      <div
        className={`flex h-full w-full items-center justify-center rounded-[9px] border border-border text-[11px] font-semibold ${
          isMe ? 'bg-primary/15 text-primary' : palette.avatar
        }`}
        title={label}
      >
        {label.slice(0, 2).toUpperCase()}
      </div>
    </Avatar>
  );
}

// A17 task status dot (9/18 convention), now shared: the visual lives in
// `WorkerSessionCornerDot` so message avatars and the member list use the
// exact same dot (one source of truth — 9/19 member-list addition).

function ActionIcon({ path, size = 12, label }: { path: string; size?: number; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label={label}>
      <path d={path} />
    </svg>
  );
}

  const ICON_PATHS = {
  reply: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  thread: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  edit: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z',
  copy: 'M8 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  cancel: 'M6 6l12 12M18 6L6 18',
  resend: 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
};

function ActionButton({
  title,
  icon,
  iconNode,
  onClick,
}: {
  title: string;
  icon?: string;
  iconNode?: React.ReactNode;
  onClick: (_e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
      title={title}
      aria-label={title}
    >
      {iconNode ?? (icon ? <ActionIcon path={icon} label={title} /> : null)}
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
  onOpenWorkerChats,
  senderShort,
  memberMap,
  readReceipts,
  currentUserId,
  senderStatus,
}: MessageBubbleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const showAvatar = !isContinuation && showSender;

  // Sender identity, resolved with priority: owning worker name → room member
  // display name → MXID localpart. In team rooms several workers talk in the
  // same conversation, so surfacing the worker identity (name + runtime badge
  // + stable color) is what makes messages distinguishable.
  const senderLabel = message.workerName
    || memberMap?.[message.sender]
    || senderShort
    || message.senderShort;
  const senderColor = senderPalette(message.sender).name;

  // The manager bot's container lifecycle lines are rendered as a status
  // notice rather than a conversation bubble.
  const lifecycleNotice = useMemo(() => {
    if (message.isMe || message.isStreaming) return null;
    const label = message.workerName || memberMap?.[message.sender] || senderLabel;
    return isManagerSender(message.sender, label)
      ? parseWorkerLifecycleNotice(message.content)
      : null;
  }, [message.isMe, message.isStreaming, message.workerName, message.sender, message.content, memberMap, senderLabel]);

  const parsedBlocks = useMemo<ParsedA2uiBlock[]>(() => {
    // Turn-coalesced messages carry blocks already normalized from their
    // constituent Matrix events (placeholder + process notices + answer).
    if (message.precomputedBlocks) return message.precomputedBlocks;
    // Same guard as hitl-inbox: relation-only / structured-run events may
    // arrive without a string body (#1436).
    return normalizeToBlocks({
      body: typeof message.content === 'string' ? message.content : '',
      formattedBody: typeof message.formattedContent === 'string' ? message.formattedContent : undefined,
      content: message.rawContent ?? {},
      isStreaming: !!message.isStreaming,
      isMine: message.isMe,
      runtime: message.runtime ?? null,
    });
  }, [message.precomputedBlocks, message.content, message.formattedContent, message.rawContent, message.isStreaming, message.isMe, message.runtime]);

  // Worker messages fold their whole process (thinking + tool calls) into one
  // disclosure per contiguous segment: the avatar anchors a compact summary
  // and the result output stays visible below it. Own messages keep the raw
  // rendering so an edited/echoed bubble never hides what the user typed.
  const processSegments = useMemo(() => {
    const runs = new Map<number, ParsedA2uiBlock[]>();
    const folded = new Set<number>();
    if (message.isMe) return { runs, folded };
    let idx = 0;
    while (idx < parsedBlocks.length) {
      if (!isProcessBlock(parsedBlocks[idx])) {
        idx += 1;
        continue;
      }
      const start = idx;
      const run: ParsedA2uiBlock[] = [];
      while (idx < parsedBlocks.length && isProcessBlock(parsedBlocks[idx])) {
        run.push(parsedBlocks[idx]);
        folded.add(idx);
        idx += 1;
      }
      runs.set(start, run);
    }
    return { runs, folded };
  }, [parsedBlocks, message.isMe]);

  // Feed the Worker card vitals strip: count this message's tool_call blocks
  // once it is final (delta-guarded per event id, so revisions don't double
  // count). Best-effort — never blocks rendering.
  const toolCallBlockCount = useMemo(
    () => parsedBlocks.filter((block) => block.type === 'tool_call').length,
    [parsedBlocks],
  );
  useEffect(() => {
    if (message.workerName && message.eventId && toolCallBlockCount > 0 && !message.isStreaming) {
      recordToolCalls(message.workerName, message.eventId, toolCallBlockCount);
    }
  }, [message.workerName, message.eventId, toolCallBlockCount, message.isStreaming]);

  const handleConfirmationApprove = useCallback((reply: string) => {
    if (!onSendConfirmation) return;
    onSendConfirmation(reply, message.sender, message.eventId);
  }, [onSendConfirmation, message.sender, message.eventId]);

  const handleConfirmationReject = useCallback((reply: string) => {
    if (!onSendConfirmation) return;
    onSendConfirmation(reply, message.sender, message.eventId);
  }, [onSendConfirmation, message.sender, message.eventId]);
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

  // 文本消息使用贴合内容的对话气泡；卡片/文件消息仍占满阅读列。
  // 配色沿用 2026-10 装验口径：自己=emerald 浅底，Agent=中性浅底，无阴影。
  // 同组续接消息收紧间距与上圆角，避免一串气泡看起来像独立卡片。
  const isTextBubble = message.type === 'm.text' && !message.mediaUrl;
  const bubbleClasses = [
    'break-words text-[13.5px] leading-relaxed text-foreground',
    isTextBubble
      ? 'w-fit max-w-full rounded-2xl border px-3.5 py-2'
      : 'w-full',
    isTextBubble && !isContinuation ? (message.isMe ? 'rounded-tr-md' : 'rounded-tl-md') : '',
    isTextBubble
      ? message.isMe
        ? 'bg-emerald-500/10 text-foreground border-emerald-500/25'
        : 'bg-muted/60 text-foreground border-border/40'
      : '',
    message.status === 'error' ? 'ring-1 ring-red-400/70' : '',
    message.status === 'sending' ? 'opacity-70' : '',
  ].join(' ');

  if (lifecycleNotice) {
    return <LifecycleNoticeRow notice={lifecycleNotice} timestamp={message.timestamp} />;
  }

  return (
    <div
      className={`group/message relative flex gap-3 py-0.5 ${!isContinuation ? 'mt-3' : ''} ${message.isMe ? 'flex-row-reverse' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        // Mobile: tap the message to toggle the action bar (desktop uses hover).
        setShowActions(v => !v);
      }}
    >
      {/* Avatar column: mirrors the bubble side (own messages on the right).
          C (#1295): worker senders' avatars are clickable → read-only
          QwenPaw sessions of that worker ("补头": the headless worker's
          sessions, viewable from the room). */}
      <div className="w-[30px] shrink-0">
        {showAvatar && (
          <button
            type="button"
            disabled={!message.workerName || !onOpenWorkerChats}
            onClick={(e) => {
              e.stopPropagation();
              if (message.workerName && onOpenWorkerChats) onOpenWorkerChats(message.workerName);
            }}
            title={message.workerName && onOpenWorkerChats ? `查看 ${senderLabel} 的会话` : undefined}
            aria-label={message.workerName && onOpenWorkerChats ? `查看 ${senderLabel} 的会话` : undefined}
            className={
              message.workerName && onOpenWorkerChats
                ? 'relative h-[30px] w-[30px] cursor-pointer rounded-[9px] transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary/50'
                : 'relative h-[30px] w-[30px]'
            }
          >
            <AvatarWithInitials sender={message.sender} label={senderLabel} isMe={message.isMe} />
            {senderStatus && !message.isMe && <WorkerSessionCornerDot state={senderStatus} />}
          </button>
        )}
      </div>

      <div className={`flex min-w-0 flex-1 flex-col ${message.isMe ? 'items-end' : 'items-start'}`}>
        {showAvatar && (
          <div className={`mb-1 flex w-full min-w-0 flex-wrap items-center gap-2 ${message.isMe ? 'flex-row-reverse' : ''}`}>
            <span className={`text-[12.5px] font-semibold ${message.isMe ? 'text-primary' : senderColor}`}>
              {senderLabel}
            </span>
            {message.workerName && message.runtime && (
              <RuntimeBadge runtime={message.runtime} size="sm" />
            )}
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
            {/* 设计稿把时间放在名字行最右侧；发送/已读标记跟随时间一起排。 */}
            <span className={`flex shrink-0 items-center gap-1 ${message.isMe ? 'mr-auto pr-3' : 'ml-auto pl-3'}`}>
              <MessageTime timestamp={message.timestamp} />
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
            </span>
          </div>
        )}

        <div className={`flex w-full items-start gap-2 ${message.isMe ? 'flex-row-reverse' : ''}`}>
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
              {/* Optimistic local sends carry refs directly (no event content yet). */}
              {message.fileRefs && message.fileRefs.length > 0 && (
                <div className="w-full">
                  <FileRefChips refs={message.fileRefs} />
                </div>
              )}
              {parsedBlocks.map((block, idx) => {
                const processRun = processSegments.runs.get(idx);
                if (processRun) {
                  return (
                    <div key={idx} className="w-full">
                      <RunProcessDisclosure
                        blocks={processRun}
                        isStreaming={!!message.isStreaming}
                        runtime={message.runtime ?? null}
                        eventId={message.eventId}
                        revisionCount={message.revisionCount}
                      />
                    </div>
                  );
                }
                if (processSegments.folded.has(idx)) return null;
                if (block.type === 'confirmation' && onSendConfirmation) {
                  // F2.1 分流：v2 结构化提问（question/options/questions）走
                  // 选项式干预卡；v1 二态工具确认保持原卡（向后兼容）。
                  if (isInterventionConfirmation(block)) {
                    return (
                      <div key={idx} className="w-full">
                        <InterventionCard
                          payload={(block as RuntimeConfirmationBlock).payload}
                          onAnswer={handleConfirmationApprove}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="w-full">
                      <ConfirmationCard
                        payload={block.payload as unknown as ConfirmationCardPayload}
                        onApprove={handleConfirmationApprove}
                        onReject={handleConfirmationReject}
                      />
                    </div>
                  );
                }
                if (block.type === 'review.report') {
                  // F3.1 结构化审查报告卡；无结构时本分支不触发，
                  // 消息照常走 Markdown 渲染（降级不丢内容）。
                  return (
                    <div key={idx} className="w-full">
                      <ReviewReportCard
                        payload={block.payload as unknown as import('@/lib/a2ui/protocol').RuntimeReviewReportBlock['payload']}
                        eventId={message.eventId}
                        onSend={
                          onSendConfirmation
                            ? (content) => onSendConfirmation(content, message.sender, message.eventId)
                            : undefined
                        }
                      />
                    </div>
                  );
                }
                if (block.type === 'tool_call') {
                  return (
                    <div key={idx} className="w-full">
                      <ToolCallView
                        payload={block.payload as ToolCallPayload}
                        runtime={block.runtimeHint}
                        eventId={message.eventId}
                        revisionCount={message.revisionCount}
                      />
                    </div>
                  );
                }
                if (block.type === 'workflow') {
                  return <WorkflowCard key={idx} payload={block.payload as import('@/lib/a2ui/workflow').WorkflowPayload} />;
                }
                if (block.type === 'thinking') {
                  return (
                    <div key={idx} className="w-full">
                      <ThinkingCard
                        content={block.content || ''}
                        isStreaming={block.isStreaming ?? message.isStreaming}
                        runtime={block.runtimeHint}
                        eventId={message.eventId}
                        revisionCount={message.revisionCount}
                      />
                    </div>
                  );
                }
                if (block.type === 'error' && block.payload) {
                  return (
                    <div key={idx} className="w-full">
                      <RunEndingNote payload={block.payload as unknown as RunEndingPayload} />
                    </div>
                  );
                }
                if (block.type === 'card') {
                  return <div key={idx} className="w-full"><StreamingCard payload={block.payload as Record<string, unknown>} /></div>;
                }
                if (block.type === 'a2ui' && block.isStreaming) {
                  return (
                    <div key={idx} className="w-full rounded-xl border border-border/60 bg-card/70 px-3 py-1 shadow-sm">
                      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>正在生成交互内容...</span>
                      </div>
                    </div>
                  );
                }
                if (block.type === 'a2ui' && block.messages) {
                  return <div key={idx} className="w-full rounded-xl border border-border/60 bg-card/70 px-3 py-1 shadow-sm"><A2uiMessage messages={block.messages} /></div>;
                }
                if (block.type === 'attachment' && block.payload) {
                  return (
                    <div key={idx} className="w-full">
                      <AttachmentCard payload={block.payload as unknown as AttachmentPayload} />
                    </div>
                  );
                }
                if (block.type === 'file_refs' && block.refs && block.refs.length > 0) {
                  return (
                    <div key={idx} className="w-full">
                      <FileRefChips refs={block.refs} />
                    </div>
                  );
                }
                if (block.type === 'text' && block.text) {
                  // F2.1 降级完整形态：上游未发 v2 块时，Agent 文本回复中的
                  // 「问句 + 编号选项」升格为选项式干预卡（提交转自然语言
                  // 消息回房间）。发卡片能力在 Dashboard 侧，不依赖上游。
                  // 按 text block 逐个判定：多块消息里每块各自渲染，避免
                  // 整条消息判定后同一张卡在多个块上重复出现。block.text
                  // 可能是 formatted_body 的 HTML 片段，解析器内部会先剥标签。
                  const heuristic =
                    !message.isMe && !message.isStreaming
                      ? parseInterventionHeuristic(block.text)
                      : null;
                  if (heuristic && onSendConfirmation) {
                    return (
                      <div key={idx} className="w-full space-y-1.5">
                        {/* 引言（选项块之前）原样保留 */}
                        {heuristic.before && (
                          <div className={bubbleClasses}>
                            <MarkdownMessage
                              content={heuristic.before}
                              msgType={message.type}
                              mediaUrl={message.mediaUrl}
                              mediaInfo={message.mediaInfo}
                              memberMap={memberMap}
                            />
                          </div>
                        )}
                        <InterventionCard
                          payload={heuristicToInterventionPayload(
                            heuristic,
                            `heuristic:${message.eventId ?? message.id}:${idx}`
                          )}
                          onAnswer={handleConfirmationApprove}
                        />
                        {/* 同一条消息里的其它问题（选项块之后）原样保留 */}
                        {heuristic.after && (
                          <div className={bubbleClasses}>
                            <MarkdownMessage
                              content={heuristic.after}
                              msgType={message.type}
                              mediaUrl={message.mediaUrl}
                              mediaInfo={message.mediaInfo}
                              memberMap={memberMap}
                            />
                          </div>
                        )}
                      </div>
                    );
                  }
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

          <TurnStateNote state={message.turnState} hasBlocks={parsedBlocks.length > 0} />

          {/* 续接消息（同发送者分组）默认不占行：时间/回执在 hover 时显示在行尾。 */}
          {!showAvatar && (
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
          )}
        </div>

        {message.replyCount && message.replyCount > 0 && onOpenThread && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenThread(message);
            }}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary"
            title="在话题中查看回复"
          >
            <span>↩</span>
            {message.replyCount} 条回复
          </button>
        )}

        {actionsVisible && (
          <div
            className={`z-10 mt-1 flex gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-sm backdrop-blur max-md:static md:absolute ${message.isMe ? 'justify-end md:left-1' : 'justify-start md:right-1'} ${showAvatar ? 'md:top-7' : 'md:top-1'}`}
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
              <ActionButton title="在话题中回复" icon={ICON_PATHS.thread} onClick={() => onOpenThread(message)} />
            )}
            {onCopy && (
              <ActionButton
                title="复制"
                iconNode={<Copy className="w-3 h-3" aria-hidden="true" />}
                onClick={() => onCopy(message)}
              />
            )}
            {onOpenWorkerFiles && !message.isMe && (message.workerName || message.sender) && (
              <ActionButton title="查看工作目录" icon={ICON_PATHS.folder} onClick={() => onOpenWorkerFiles(message)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
