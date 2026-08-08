'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from './ChatStore';
import { MessageList, type LocalOutboundMessage, type ChatSystemNotice } from './structures/MessageList';
import { ThreadPanel } from './structures/ThreadPanel';
import type { ScrollPanelHandle } from './structures/ScrollPanel';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  useMatrixRoomMessages,
  useMatrixRoomMembers,
  useMatrixRoomState,
  useMatrixSendMessage,
  useMatrixReadMarker,
  useMatrixSetReadMarker,
  useMatrixEditMessage,
  useMatrixRedactMessage,
  formatMatrixEvents,
  type DisplayMessage,
  type RoomMember,
} from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import { MatrixRequestError, getRateLimitRetryDelay } from '@/lib/matrix-api';
import { useMatrixReadReceipts } from '@/hooks/use-matrix';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Users, PanelRightClose, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatComposer, type MentionEntry } from './chat-composer';
import { TypingIndicator } from './typing-indicator';
import { useMatrixTypingUsers, useTypingNotification, useTypingSync, useMatrixUploadMedia } from '@/hooks/use-matrix';

interface ChatRoomProps {
  roomId: string;
  roomName: string;
  topic?: string;
  avatar?: string;
  members?: RoomMember[];
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }, _mentions?: MentionEntry[]) => void;
  className?: string;
}

export function ChatRoom({
  roomId,
  roomName,
  topic,
  avatar,
  members: initialMembers = [],
  canSend = true,
  onSendMessage,
  className = '',
}: ChatRoomProps) {
  const { setAutoScroll } = useChatStore();
  const [autoScroll, setAutoScrollLocal] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [showMembers, setShowMembers] = useState(false);
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  const [activeThread, setActiveThread] = useState<DisplayMessage | null>(null);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [localMessages, setLocalMessages] = useState<LocalOutboundMessage[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [systemNotices, setSystemNotices] = useState<ChatSystemNotice[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const noticeCounterRef = useRef(0);

  const { userId, isLoggedIn } = useMatrixStore();
  const sendMutation = useMatrixSendMessage();
  const uploadMutation = useMatrixUploadMedia();
  const editMutation = useMatrixEditMessage();
  const redactMutation = useMatrixRedactMessage();
  const setReadMarkerMutation = useMatrixSetReadMarker();
  const readMarkerQuery = useMatrixReadMarker(roomId);
  const { notifyTyping, stopTyping } = useTypingNotification(roomId);
  const typingUsers = useMatrixTypingUsers(roomId);
  // Long-poll /sync so typing notifications from other members show up live.
  useTypingSync(roomId);
  const scrollRef = useRef<ScrollPanelHandle>(null);
  const prevMsgCountRef = useRef(0);
  const prevMsgLastIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const localCounterRef = useRef(0);
  const didInitialScrollRef = useRef(false);

  const messagesQuery = useMatrixRoomMessages(roomId);
  const membersQuery = useMatrixRoomMembers(roomId);
  const stateQuery = useMatrixRoomState(roomId);

  const currentUserId = userId;
  // Latest m.read receipts of every member, used for the ✓✓ read indicator.
  const readReceipts = useMatrixReadReceipts(roomId);

  const allEvents = useMemo<MatrixEvent[]>(() => {
    if (!messagesQuery.isSuccess || !messagesQuery.data) return [];
    const events: MatrixEvent[] = [];
    for (const page of messagesQuery.data.pages) {
      if (page.chunk) events.push(...page.chunk);
    }
    return events;
  }, [messagesQuery.data, messagesQuery.isSuccess]);

  const formattedMessages = useMemo<DisplayMessage[]>(() => {
    return formatMatrixEvents(allEvents, currentUserId);
  }, [allEvents, currentUserId]);

  const loadMore = useCallback(async () => {
    if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return;
    await messagesQuery.fetchNextPage();
  }, [messagesQuery]);

  const roomMembers = useMemo<RoomMember[]>(() => {
    // m.room.member events carry the affected user id in `state_key` (the
    // sender is whoever updated the membership, which is not necessarily the
    // member themselves). Only joined members are shown / mentionable.
    if (membersQuery.data?.chunk) {
      return membersQuery.data.chunk
        .filter((e) => e.type === 'm.room.member' && e.content?.membership === 'join')
        .map((e) => ({
          userId: e.state_key || '',
          displayName: String(e.content?.displayname || e.state_key?.split(':')[0]?.slice(1) || ''),
          membership: 'join',
        }));
    }
    if (stateQuery.data) {
      return stateQuery.data
        .filter((e) => e.type === 'm.room.member' && e.content?.membership === 'join')
        .map((e) => ({
          userId: e.state_key || e.sender || '',
          displayName: String(e.content?.displayname || e.state_key?.split(':')[0]?.slice(1) || e.sender || ''),
          membership: 'join',
        }));
    }
    return initialMembers;
  }, [membersQuery.data, stateQuery.data, initialMembers]);

  // m.fully_read account-data marker → anchor for the "unread" divider line.
  const readEventId = readMarkerQuery.data?.event_id ?? null;

  // Persist the read marker to the last visible message whenever the user is
  // pinned to the bottom (on arrival of new messages or on scroll-back-down).
  const markAllRead = useCallback(() => {
    const last = formattedMessages[formattedMessages.length - 1];
    if (!last) return;
    const target = last.eventId || last.id;
    if (!target || target === readEventId || setReadMarkerMutation.isPending) return;
    setReadMarkerMutation.mutate({ roomId, eventId: target }, {
      onError: (err) => {
        // m.fully_read may not be supported by all homeservers; silently ignore
        const code = (err as { errcode?: string })?.errcode;
        if (code !== 'M_BAD_JSON') console.warn('Failed to set read marker:', err);
      },
    });
  }, [formattedMessages, readEventId, setReadMarkerMutation, roomId]);

  // Single watcher for newly appended messages: scroll down when pinned to
  // the bottom, otherwise accumulate a "new messages" counter for the badge.
  useEffect(() => {
    const lastId = formattedMessages.length > 0 ? formattedMessages[formattedMessages.length - 1].id : null;
    const lastChanged = lastId !== prevMsgLastIdRef.current;
    const countChanged = formattedMessages.length !== prevMsgCountRef.current;

    if (lastChanged) {
      const added = Math.max(0, formattedMessages.length - prevMsgCountRef.current);
      if (autoScroll && atBottomRef.current) {
        // followOutput already pins the list; this nudge covers media/resize.
        scrollRef.current?.scrollToBottom({ smooth: false });
        markAllRead();
      } else if (added > 0) {
        setNewMessagesCount(c => c + added);
      }
    } else if (countChanged && !autoScroll) {
      // Only older pages were prepended; keep the badge untouched.
    }

    prevMsgCountRef.current = formattedMessages.length;
    prevMsgLastIdRef.current = lastId;
  }, [formattedMessages, autoScroll, markAllRead]);

  // Landing position for a freshly opened room: Virtuoso's
  // initialTopMostItemIndex only applies at mount time, when the list is still
  // empty, so the first load after data arrives must scroll to the latest
  // message explicitly. Without this the room opens at the top and the user
  // has to pull down manually.
  useEffect(() => {
    if (!messagesQuery.isSuccess || formattedMessages.length === 0) return;
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    scrollRef.current?.scrollToBottom({ smooth: false });
    markAllRead();
  }, [messagesQuery.isSuccess, formattedMessages, markAllRead]);

  const removeLocal = useCallback((clientId: string) => {
    setLocalMessages(prev => prev.filter(m => m.clientId !== clientId));
  }, []);

  const patchLocal = useCallback((clientId: string, patch: Partial<LocalOutboundMessage>) => {
    setLocalMessages(prev => prev.map(m => m.clientId === clientId ? { ...m, ...patch } : m));
  }, []);

  const pushSystemNotice = useCallback((notice: ChatSystemNotice) => {
    setSystemNotices(prev => {
      // De-duplicate on identical messages: refresh the countdown instead of
      // stacking an endless pile of banners on repeated throttling.
      const existing = prev.find(n => n.kind === notice.kind && n.message === notice.message);
      if (existing) {
        return prev.map(n =>
          n.id === existing.id
            ? { ...n, createdAt: Date.now(), retryAfterMs: notice.retryAfterMs, autoRetry: notice.autoRetry }
            : n
        );
      }
      return [...prev, notice];
    });
  }, []);

  const sendOutbound = useCallback((params: {
    content: string;
    options?: { html?: boolean };
    mentions?: MentionEntry[];
    replyTo?: DisplayMessage | null;
    clientId?: string;
  }) => {
    if (!roomId || !isLoggedIn || !userId) return;
    const { content, options, mentions, replyTo, clientId } = params;

    // Only mentions that still appear in the final text are sent (the user may
    // have typed more after inserting them, or deleted the placeholder again).
    const activeMentions = (mentions ?? []).filter((m) => content.includes(m.placeholder));
    const mentionUserIds = activeMentions.map(m => m.userId);
    const mentionData = mentionUserIds.length > 0
      ? { 'm.mentions': { user_ids: mentionUserIds } }
      : {};

    // Build a Matrix-compatible formatted body with clickable mention links
    // (https://matrix.to/#/userId). Without these the receiver only sees the
    // raw "@name" text and the mention is not actionable.
    let formattedBody: string | undefined = options?.html ? content : undefined;
    if (activeMentions.length > 0) {
      let body = formattedBody ?? content;
      for (const m of activeMentions) {
        const link = `<a href="https://matrix.to/#/${encodeURIComponent(m.userId)}">${m.displayName}</a>`;
        body = body.replaceAll(m.placeholder, link);
      }
      formattedBody = body;
    }
    const cid = clientId ?? `local-${Date.now()}-${++localCounterRef.current}`;

    // First attempt renders an optimistic "sending" bubble; a retry keeps the
    // existing entry and flips it back to sending.
    if (!clientId) {
      setLocalMessages(prev => [...prev, {
        clientId: cid,
        sender: userId,
        senderShort: userId.startsWith('@') ? userId.split(':')[0].slice(1) : userId,
        content,
        formattedContent: formattedBody ?? (options?.html ? content : undefined),
        mentions,
        replyTo,
        timestamp: Date.now(),
        status: 'sending' as const,
      }]);
    }

    sendMutation.mutate(
      {
        roomId,
        body: content,
        formattedBody,
        extra: mentionData,
        relatesTo: replyTo ? { 'm.in_reply_to': { event_id: replyTo.eventId || replyTo.id } } : undefined,
      },
      {
        onSuccess: () => removeLocal(cid),
        onError: (err) => {
          patchLocal(cid, { status: 'error', error: err.message });
          pushSystemNotice(buildSystemNoticeFromError(err, { content, mentions, replyTo }, ++noticeCounterRef.current));
        },
      }
    );
  }, [roomId, isLoggedIn, userId, sendMutation, removeLocal, patchLocal, pushSystemNotice]);

  const removeSystemNotice = useCallback((notice: ChatSystemNotice) => {
    setSystemNotices(prev => prev.filter(n => n.id !== notice.id));
  }, []);

  const handleRetryNotice = useCallback((notice: ChatSystemNotice) => {
    const payload = notice.retryPayload;
    setSystemNotices(prev => prev.filter(n => n.id !== notice.id));
    if (payload && roomId && isLoggedIn && userId) {
      sendOutbound({ content: payload.content, mentions: payload.mentions, replyTo: payload.replyTo });
    }
  }, [sendOutbound, roomId, isLoggedIn, userId]);

  // Upload a file to the Matrix homeserver, then send it as an m.image /
  // m.file message so it appears in the room timeline like any other message.
  const handleFileUpload = useCallback(async (file: File) => {
    if (!roomId || !isLoggedIn || !userId) return;
    setIsUploading(true);
    const cid = `local-${Date.now()}-${++localCounterRef.current}`;
    const isImage = file.type.startsWith('image/');
    setLocalMessages(prev => [...prev, {
      clientId: cid,
      sender: userId,
      senderShort: userId.startsWith('@') ? userId.split(':')[0].slice(1) : userId,
      content: file.name,
      timestamp: Date.now(),
      status: 'sending' as const,
    }]);
    try {
      const { content_uri } = await uploadMutation.mutateAsync({ roomId, file });
      const extra: Record<string, unknown> = {
        msgtype: isImage ? 'm.image' : 'm.file',
        url: content_uri,
        info: {
          mimetype: file.type || 'application/octet-stream',
          size: file.size,
        },
      };
      sendMutation.mutate(
        { roomId, body: file.name, extra },
        {
          onSuccess: () => removeLocal(cid),
          onError: (err) => {
            patchLocal(cid, { status: 'error', error: err.message });
            pushSystemNotice(buildSystemNoticeFromError(err, { content: file.name }, ++noticeCounterRef.current));
          },
        }
      );
    } catch (err) {
      patchLocal(cid, {
        status: 'error',
        error: err instanceof Error ? err.message : '上传失败',
      });
      pushSystemNotice(buildSystemNoticeFromError(err, { content: file.name }, ++noticeCounterRef.current));
    } finally {
      setIsUploading(false);
    }
  }, [roomId, isLoggedIn, userId, uploadMutation, sendMutation, removeLocal, patchLocal, pushSystemNotice]);

  const handleSend = useCallback((content: string, _options?: { html?: boolean }, mentions?: MentionEntry[]) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (onSendMessage) {
      onSendMessage(trimmed, _options, mentions);
      return;
    }
    if (!roomId || !isLoggedIn) return;

    sendOutbound({ content: trimmed, options: _options, mentions, replyTo });
    // Sending a message immediately ends the typing state, otherwise other
    // members keep seeing "typing" for up to the full timeout window.
    stopTyping();
    setInputValue('');
    setMentions([]);
    setReplyTo(null);
  }, [onSendMessage, roomId, isLoggedIn, sendOutbound, stopTyping, replyTo]);

  const handleInputChange = useCallback((content: string) => {
    setInputValue(content);
    if (content.trim()) {
      notifyTyping();
    } else {
      stopTyping();
    }
  }, [notifyTyping, stopTyping]);

  const handleAutoScrollChange = useCallback((auto: boolean) => {
    setAutoScrollLocal(auto);
    setAutoScroll(auto);
  }, [setAutoScroll]);

  const handleJumpToNew = useCallback(() => {
    setNewMessagesCount(0);
    handleAutoScrollChange(true);
    scrollRef.current?.scrollToBottom({ smooth: true });
  }, [handleAutoScrollChange]);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom;
    if (atBottom) {
      // Reaching the bottom marks everything as read.
      setNewMessagesCount(0);
      markAllRead();
      if (!autoScroll) handleAutoScrollChange(true);
    } else if (autoScroll) {
      handleAutoScrollChange(false);
    }
  }, [autoScroll, handleAutoScrollChange, markAllRead]);

  const handleReply = useCallback((message: DisplayMessage) => {
    setReplyTo(message);
    const idx = formattedMessages.findIndex(m => m.id === message.id || m.eventId === message.eventId);
    if (idx >= 0) {
      // Scroll to the replied message.
      scrollRef.current?.scrollToIndex(idx);
    } else {
      scrollRef.current?.scrollToBottom({ smooth: true });
    }
  }, [formattedMessages]);

  const handleCopy = useCallback((message: DisplayMessage) => {
    navigator.clipboard.writeText(message.content);
  }, []);

  const handleEditSubmit = useCallback(async (message: DisplayMessage, newContent: string) => {
    if (!message.isMe) return;
    setActionError(null);
    await editMutation.mutateAsync({
      roomId,
      eventId: message.eventId || message.id,
      body: newContent,
    });
  }, [roomId, editMutation]);

  const handleDelete = useCallback((message: DisplayMessage) => {
    // Locally tracked (failed) messages are dropped without a server call.
    if (message.status === 'error' || message.id.startsWith('local-')) {
      removeLocal(message.id);
      return;
    }
    if (!message.isMe) return;
    if (!window.confirm('确定删除这条消息吗？此操作不可撤销。')) return;
    setActionError(null);
    redactMutation.mutate(
      { roomId, eventId: message.eventId || message.id },
      { onError: (err) => setActionError(err.message) }
    );
  }, [roomId, redactMutation, removeLocal]);

  const handleResendLocal = useCallback((message: DisplayMessage) => {
    const local = localMessages.find(m => m.clientId === message.id);
    if (!local) return;
    setActionError(null);
    patchLocal(local.clientId, { status: 'sending', error: undefined });
    sendOutbound({
      content: local.content,
      options: local.formattedContent ? { html: true } : undefined,
      mentions: local.mentions,
      replyTo: local.replyTo,
      clientId: local.clientId,
    });
  }, [localMessages, patchLocal, sendOutbound]);

  const handleSendConfirmation = useCallback((content: string) => {
    sendOutbound({ content });
  }, [sendOutbound]);

  const handleCancelLocal = useCallback((message: DisplayMessage) => {
    removeLocal(message.id);
  }, [removeLocal]);

  const memberMap = useMemo(
    () => Object.fromEntries(roomMembers.map(m => [m.userId, m.displayName])),
    [roomMembers]
  );

  const handleOpenThread = useCallback((message: DisplayMessage) => {
    // A thread panel replaces the member list, element-web style.
    setShowMembers(false);
    setActiveThread(message);
  }, []);

  const header = useMemo(() => (
    <div className="flex items-center gap-2 px-4 py-3 border-b bg-card/70 backdrop-blur-sm">
      {avatar ? (
        <Avatar className="w-8 h-8 shrink-0">
          <img src={avatar} alt={roomName} />
        </Avatar>
      ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/90 to-primary/55 flex items-center justify-center shadow-sm">
           <span className="text-xs font-semibold text-white">{roomName.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="font-semibold text-sm truncate">{roomName}</h3>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="实时同步" />
        </div>
        {topic && (
          <p className="text-xs text-muted-foreground truncate">{topic}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 shrink-0"
        onClick={() => setShowMembers(v => !v)}
        title={showMembers ? '隐藏成员' : '显示成员'}
      >
        <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-primary/10">
          <Users className="w-3 h-3 mr-1" />
          {roomMembers.length}
        </Badge>
      </Button>
    </div>
  ), [roomName, topic, avatar, roomMembers.length, showMembers]);

  return (
    <div className={`flex h-full ${className}`}>
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {header}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {actionError && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-600 dark:text-red-400 shrink-0">
              <span className="truncate flex-1">{actionError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 shrink-0 hover:text-red-700"
                onClick={() => setActionError(null)}
              >
                <PanelRightClose className="w-3 h-3" />
              </Button>
            </div>
          )}
          {replyTo && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400 shrink-0">
              <span>回复 {replyTo.senderShort}:</span>
              <span className="truncate flex-1">{replyTo.content.slice(0, 80)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 shrink-0 text-emerald-600 hover:text-emerald-700"
                onClick={() => setReplyTo(null)}
              >
                <PanelRightClose className="w-3 h-3" />
              </Button>
            </div>
          )}
          <MessageList
            ref={scrollRef}
            messages={formattedMessages}
            localMessages={localMessages}
            readEventId={readEventId}
            hasNextPage={messagesQuery.hasNextPage || false}
            isFetchingNextPage={messagesQuery.isFetchingNextPage}
            onLoadMore={loadMore}
            loading={messagesQuery.isLoading}
            _canSend={canSend && isLoggedIn}
            _onSend={handleSend}
            onReply={handleReply}
            onCopy={handleCopy}
            onOpenThread={handleOpenThread}
            onEdit={handleEditSubmit}
            onDelete={handleDelete}
            onResend={handleResendLocal}
            onCancel={handleCancelLocal}
            onSendConfirmation={handleSendConfirmation}
            memberMap={memberMap}
            onAtBottomChange={handleAtBottomChange}
            notices={systemNotices}
            onRetryNotice={handleRetryNotice}
            onDismissNotice={removeSystemNotice}
            readReceipts={readReceipts}
            currentUserId={currentUserId}
            className="flex-1 min-h-0"
          />
          {/* Floating "new messages" badge, element-web style jump-to-latest */}
          {newMessagesCount > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={handleJumpToNew}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs shadow-lg hover:bg-primary/90 transition-colors"
              >
                <ArrowDown className="w-3 h-3" />
                {newMessagesCount} 条新消息
              </button>
            </div>
          )}
          <TypingIndicator users={typingUsers} />
          <ChatComposer
            value={inputValue}
            onChange={handleInputChange}
            onSend={() => handleSend(inputValue, undefined, mentions)}
            isSending={sendMutation.isPending}
            sendError={sendMutation.error?.message ?? null}
            placeholder={replyTo ? `回复 ${replyTo.senderShort}... (Enter 发送)` : `发送消息到 ${roomName}... (Enter 发送, Shift+Enter 换行)`}
            disabled={!canSend || !isLoggedIn}
            members={roomMembers.map(m => ({ userId: m.userId, displayName: m.displayName }))}
            onFileUpload={handleFileUpload}
            isUploading={isUploading}
            onSlashCommand={(cmd) => {
              if (cmd === 'members') setShowMembers(v => !v);
            }}
            onMentionsChange={setMentions}
          />
          </div>
        </div>

      {/* Members sidebar */}
      {showMembers && (
        <div className="w-52 shrink-0 border-l border-border bg-card overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
            <h4 className="font-semibold text-xs">成员 ({roomMembers.length})</h4>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setShowMembers(false)}>
              <PanelRightClose className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
            {roomMembers.map((member) => {
              const color = member.userId.split(':').pop() === 'agentteams.io'
                ? 'text-emerald-600'
                : 'text-muted-foreground';
              return (
                <div
                  key={member.userId}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                  onClick={() => {
                    navigator.clipboard.writeText(member.userId);
                  }}
                  title="点击复制用户ID"
                >
                  <Avatar className="w-6 h-6 shrink-0">
                    <AvatarFallback className={`text-[8px] ${color}`}>
                      {member.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{member.displayName}</p>
                    <p className="text-[9px] text-muted-foreground font-mono truncate">
                      {member.userId.split(':')[0].slice(1)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Thread sidebar */}
      {activeThread && (
        <ThreadPanel
          roomId={roomId}
          rootMessage={activeThread}
          memberMap={memberMap}
          onClose={() => setActiveThread(null)}
        />
      )}
    </div>
  );
}

function buildSystemNoticeFromError(
  err: unknown,
  payload: { content: string; mentions?: MentionEntry[]; replyTo?: DisplayMessage | null },
  id: number
): ChatSystemNotice {
  const retryAfterMs = getRateLimitRetryDelay(err);
  const isRateLimited = err instanceof MatrixRequestError && err.isRateLimited;
  if (isRateLimited) {
    return {
      id,
      kind: 'rate-limited',
      message: `消息发送失败：服务商限流中，${Math.ceil(retryAfterMs / 1000)} 秒后自动重试`,
      createdAt: Date.now(),
      retryAfterMs,
      autoRetry: true,
      retryPayload: payload,
    };
  }
  return {
    id,
    kind: 'error',
    message: `消息发送失败：${err instanceof Error ? err.message : '未知错误'}`,
    createdAt: Date.now(),
    autoRetry: false,
    retryPayload: payload,
  };
}
