'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from './ChatStore';
import { MessageList, type LocalOutboundMessage, type ChatSystemNotice } from './structures/MessageList';
import { ThreadPanel } from './structures/ThreadPanel';
import type { ScrollPanelHandle } from './structures/ScrollPanel';
import { usePersistedDraft } from './hooks/usePersistedDraft';
import { useFileUpload } from './hooks/useFileUpload';
import { useFileDropZone } from './hooks/useFileDropZone';
import { DragDropOverlay } from './components/DragDropOverlay';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  useMatrixRoomMessages,
  useMatrixRoomMembers,
  useMatrixRoomState,
  useMatrixSendMessage,
  useMatrixReadMarker,
  useMatrixSetReadMarker,
  useMatrixSendReadReceipt,
  useMatrixEditMessage,
  useMatrixRedactMessage,
  formatMatrixEvents,
  type DisplayMessage,
  type RoomMember,
} from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import { MatrixRequestError, getRateLimitRetryDelay } from '@/lib/matrix-api';
import { useMatrixReadReceipts, useRoomMetaStore } from '@/hooks/use-matrix';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WorkerChatsPanel } from '@/components/dashboard/sections/workers/worker-chats-panel';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, PanelRightClose, ArrowDown, FolderTree, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatComposer, type MentionEntry } from './chat-composer';
import { parseOutboundCommand } from './composer-commands';
import { TypingIndicator } from './typing-indicator';
import { AgentActivityTrack } from './agent-activity-track';
import { useMatrixTypingUsers, useTypingNotification, useMatrixUploadMedia } from '@/hooks/use-matrix';
import {
  useChatRoomSessionState,
  useWorkerAgentStatusMap,
  useSessionTick,
} from '@/hooks/use-worker-session-state';
import {
  deriveWorkerSessionState,
  type WorkerSessionState,
} from '@/lib/worker-session-state';
import { WorkerSessionDot, WorkerSessionCornerDot } from '@/components/worker-session-dot';
import { FilesBrowserPanel } from './views/worker-files-panel';
import { useRuntimeMap } from './runtime-map-context';
import type { TeamResponse } from '@/lib/agentteams-api';
import { RUNTIME_LABELS } from '@/lib/phase-colors';

/** Window within which ArrowUp recovers the latest own message for editing. */
const EDIT_WINDOW_MS = 30 * 60 * 1000;

interface ChatRoomProps {
  roomId: string;
  roomName: string;
  /** Full AgentTeams team resource for team rooms (drives the header detail). */
  team?: TeamResponse;
  /** Worker resource name owning this room; auto-selected in the files panel. */
  defaultWorkerName?: string;
  /** Worker phase shown in the conversation header. */
  roomPhase?: string;
  /** Worker runtime shown in the conversation header. */
  roomRuntime?: string;
  /** Worker MXIDs of this room — drives the session dot (A17):
   *  one MXID = 1:1 room (three states), several = team room (running
   *  only). Omitted for manager/human rooms (no dot). */
  workerMatrixUserIds?: string[];
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
  team,
  defaultWorkerName,
  roomPhase,
  roomRuntime,
  workerMatrixUserIds,
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
  const { value: inputValue, setValue: setInputValue, setValueLocal: setInputValueLocal, clear: clearDraft } = usePersistedDraft(roomId);
  // Composer edit session (ArrowUp on empty input → edit my latest message)
  const [editSession, setEditSession] = useState<{ eventId: string; initialText: string } | null>(null);
  const [localMessages, setLocalMessages] = useState<LocalOutboundMessage[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [systemNotices, setSystemNotices] = useState<ChatSystemNotice[]>([]);
  const [showWorkers, setShowWorkers] = useState(false);
  // Worker rooms default to the owning worker so the files panel opens on
  // "the current worker's" directory instead of an empty picker.
  const [selectedWorker, setSelectedWorker] = useState<string | null>(defaultWorkerName ?? null);
  // C (#1295): worker avatar click → read-only QwenPaw sessions dialog.
  const [chatsWorkerName, setChatsWorkerName] = useState<string | null>(null);
  const handleOpenWorkerChats = useCallback((name: string) => setChatsWorkerName(name), []);
  const [workerPaneWidth, setWorkerPaneWidth] = useState(320);
  const [isResizingWorkerPane, setIsResizingWorkerPane] = useState(false);
  const noticeCounterRef = useRef(0);
  const chatLayoutRef = useRef<HTMLDivElement>(null);

  const { userId, isLoggedIn } = useMatrixStore();
  const sendMutation = useMatrixSendMessage();
  const uploadMutation = useMatrixUploadMedia();
  const editMutation = useMatrixEditMessage();
  const redactMutation = useMatrixRedactMessage();
  const setReadMarkerMutation = useMatrixSetReadMarker();
  const sendReceiptMutation = useMatrixSendReadReceipt();
  const readMarkerQuery = useMatrixReadMarker(roomId);
  const { notifyTyping, stopTyping } = useTypingNotification(roomId);
  const typingUsers = useMatrixTypingUsers(roomId);
  // Session dot (A17): 1:1 rooms three states, team rooms running-only.
  const sessionDot = useChatRoomSessionState(roomId, workerMatrixUserIds);
  // Live typing indicators, read receipts and room meta are fed by the global
  // useGlobalMatrixSync loop mounted at dashboard level — no per-room loop here.
  const scrollRef = useRef<ScrollPanelHandle>(null);
  const prevMsgCountRef = useRef(0);
  const prevMsgLastIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const localCounterRef = useRef(0);
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    if (!isResizingWorkerPane) return;

    const handlePointerMove = (event: PointerEvent) => {
      const layout = chatLayoutRef.current;
      if (!layout) return;
      const bounds = layout.getBoundingClientRect();
      setWorkerPaneWidth(Math.min(600, Math.max(256, bounds.right - event.clientX)));
    };
    const stopResizing = () => setIsResizingWorkerPane(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [isResizingWorkerPane]);

  const messagesQuery = useMatrixRoomMessages(roomId);
  const membersQuery = useMatrixRoomMembers(roomId);
  const stateQuery = useMatrixRoomState(roomId);

  // Element-style realtime: messages arrive through the global /sync loop,
  // so a failed initial fetch (or refetch) is the main way the list can go
  // stale — surface it explicitly with the exact cause instead of a silent
  // "no messages" state.
  const messagesLoadError = useMemo(() => {
    const e = messagesQuery.error as
      | { status?: number; errcode?: string; message?: string }
      | null;
    if (!e) return null;
    if (e.status === 401 || e.errcode === 'M_UNKNOWN_TOKEN') return '登录已过期，请重新登录后再试';
    if (e.status === 403) return '当前登录账号不在该房间，或无权读取消息';
    if (e.status === 404) return '房间不存在或已被删除';
    if (e.status === 429) return '刷新过于频繁，请稍后重试';
    return `消息加载失败：${e.message || '未知错误'}`;
  }, [messagesQuery.error]);
  // Dismissal tracks the *error instance*, not a boolean: a fresh failure
  // (new Error object from a retry/focus refetch) is a different instance
  // than the dismissed one, so the banner re-raises itself without any
  // effect.
  const [dismissedLoadError, setDismissedLoadError] = useState<unknown>(null);
  const showLoadErrorBanner =
    messagesLoadError !== null && dismissedLoadError !== messagesQuery.error;

  const currentUserId = userId;
  // Latest m.read receipts of every member, used for the ✓✓ read indicator.
  const readReceipts = useMatrixReadReceipts(roomId);
  // MXID → owning worker runtime (empty outside ChatSection's provider).
  const runtimeMap = useRuntimeMap();

  const allEvents = useMemo<MatrixEvent[]>(() => {
    if (!messagesQuery.isSuccess || !messagesQuery.data) return [];
    const events: MatrixEvent[] = [];
    for (const page of messagesQuery.data.pages) {
      if (page.chunk) events.push(...page.chunk);
    }
    return events;
  }, [messagesQuery.data, messagesQuery.isSuccess]);

  // A17 task status dots on worker avatars in the group chat.
  // Data sources, in priority order: worker heartbeat agentStatus (15s
  // poll, unbounded "running"), live Matrix typing, then message age with
  // a 10-min done→idle decay. Humans get no dot (no map entry).
  const agentStatusMap = useWorkerAgentStatusMap();
  const sessionTick = useSessionTick();
  const senderStatusMap = useMemo<Record<string, WorkerSessionState>>(() => {
    const map: Record<string, WorkerSessionState> = {};
    const typingSet = new Set(typingUsers.map((u) => u.userId));
    // Per-sender latest message ts in this room (for the done decay when
    // the controller predates the heartbeat status fields).
    const lastTsBySender: Record<string, number> = {};
    for (const e of allEvents) {
      if (!e.sender) continue;
      if ((e.origin_server_ts ?? 0) > (lastTsBySender[e.sender] ?? 0)) {
        lastTsBySender[e.sender] = e.origin_server_ts;
      }
    }
    for (const [mxId, info] of Object.entries(agentStatusMap)) {
      map[mxId] = deriveWorkerSessionState({
        agentStatus: info,
        isTyping: typingSet.has(mxId),
        lastMessageTs: lastTsBySender[mxId],
        now: sessionTick,
        phase: info.phase,
      });
    }
    return map;
  }, [agentStatusMap, typingUsers, allEvents, sessionTick]);

  const formattedMessages = useMemo<DisplayMessage[]>(() => {
    const formatted = formatMatrixEvents(allEvents, currentUserId);
    // Stamp each message with its sender's runtime / worker name (MXID →
    // Worker lookup from ChatSection) so bubbles can badge the runtime.
    return formatted.map((message) => {
      const owner = runtimeMap[message.sender];
      return owner ? { ...message, runtime: owner.runtime, workerName: owner.workerName } : message;
    });
  }, [allEvents, currentUserId, runtimeMap]);

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

  // Persist the read marker and send an m.read receipt whenever the user is
  // pinned to the bottom (on arrival of new messages or on scroll-back-down).
  // Dual-write: m.read makes the homeserver clear the unread counter and tells
  // other members where we read up to; m.fully_read records our private read
  // position. Both are best-effort — the sidebar badge is cleared optimistically
  // and UNREAD_GRACE_MS suppresses stale counters until the server confirms.
  const markAllRead = useCallback((targetOverride?: string) => {
    const last = formattedMessages[formattedMessages.length - 1];
    const fallback = last ? (last.eventId || last.id) : null;
    const target = targetOverride || fallback;
    if (!target || target === readEventId || setReadMarkerMutation.isPending) return;
    // Optimistically clear the sidebar badge so the UI feels snappy;
    // the next /sync cycle will confirm the server-side reset.
    useRoomMetaStore.getState().clearUnread(roomId);
    sendReceiptMutation.mutate({ roomId, eventId: target });
    setReadMarkerMutation.mutate({ roomId, eventId: target }, {
      onError: (err) => {
        // m.fully_read may not be supported by all homeservers; silently ignore
        const code = (err as { errcode?: string })?.errcode;
        if (code !== 'M_BAD_JSON') console.warn('Failed to set read marker:', err);
      },
    });
  }, [formattedMessages, readEventId, setReadMarkerMutation, sendReceiptMutation, roomId]);

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
        // scrollToBottom reports "at bottom", which is the read-advance trigger.
        scrollRef.current?.scrollToBottom({ smooth: false });
      } else if (added > 0) {
        setNewMessagesCount(c => c + added);
      }
    } else if (countChanged && !autoScroll) {
      // Only older pages were prepended; keep the badge untouched.
    }

    prevMsgCountRef.current = formattedMessages.length;
    prevMsgLastIdRef.current = lastId;
  }, [formattedMessages, autoScroll]);

  // Landing position for a freshly opened room: if the read marker is behind
  // the latest message, land on the unread divider without advancing the read
  // position; otherwise land on the latest message. ScrollPanel's own initial
  // mount effect already does this, this effect is a fallback for when the
  // read marker query resolves after the message list.
  useEffect(() => {
    if (!messagesQuery.isSuccess || formattedMessages.length === 0) return;
    if (!readMarkerQuery.isSuccess && !readMarkerQuery.isError) return;
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const last = formattedMessages[formattedMessages.length - 1];
    const lastId = last ? (last.eventId || last.id) : null;
    const hasUnreadDivider = Boolean(readEventId && lastId && readEventId !== lastId);
    if (hasUnreadDivider) {
      scrollRef.current?.scrollToItem(`read-marker-${readEventId}`);
    } else {
      scrollRef.current?.scrollToBottom({ smooth: false });
    }
  }, [messagesQuery.isSuccess, formattedMessages, readEventId, readMarkerQuery.isSuccess, readMarkerQuery.isError]);

  const removeLocal = useCallback((clientId: string) => {
    setLocalMessages(prev => prev.filter(m => m.clientId !== clientId));
  }, []);

  const pushLocal = useCallback((message: LocalOutboundMessage) => {
    setLocalMessages(prev => [...prev, message]);
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
    msgtype?: string;
  }) => {
    if (!roomId || !isLoggedIn || !userId) return;
    const { content, options, mentions, replyTo, clientId, msgtype } = params;

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
        extra: { ...mentionData, ...(msgtype ? { msgtype } : {}) },
        relatesTo: replyTo ? { 'm.in_reply_to': { event_id: replyTo.eventId || replyTo.id } } : undefined,
      },
      {
        onSuccess: (data) => {
          removeLocal(cid);
          // Sending a message advances the read position to the sent event.
          markAllRead(data?.event_id);
        },
        onError: (err) => {
          patchLocal(cid, { status: 'error', error: err.message });
          pushSystemNotice(buildSystemNoticeFromError(err, { content, mentions, replyTo }, ++noticeCounterRef.current));
        },
      }
    );
  }, [roomId, isLoggedIn, userId, sendMutation, removeLocal, patchLocal, pushSystemNotice, markAllRead]);

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
  const { isUploading, upload: handleFileUpload } = useFileUpload({
    roomId,
    isLoggedIn,
    userId,
    upload: (input) => uploadMutation.mutateAsync(input),
    send: (args, callbacks) => sendMutation.mutate(args, callbacks),
    pushLocal,
    patchLocal,
    removeLocal,
    pushSystemNotice,
    buildSystemNotice: buildSystemNoticeFromError,
  });

  const handleSend = useCallback((content: string, _options?: { html?: boolean }, mentions?: MentionEntry[]) => {
    let trimmed = content.trim();
    if (!trimmed) return;
    // element-style outbound commands: /me (m.emote) and /shrug
    const parsed = parseOutboundCommand(trimmed);
    if (parsed) trimmed = parsed.body;
    const msgtype = parsed?.msgtype;

    if (onSendMessage) {
      onSendMessage(trimmed, _options, mentions);
      clearDraft();
      return;
    }
    if (!roomId || !isLoggedIn) return;

    sendOutbound({ content: trimmed, options: _options, mentions, replyTo, msgtype });
    // Sending a message immediately ends the typing state, otherwise other
    // members keep seeing "typing" for up to the full timeout window.
    stopTyping();
    clearDraft();
    setMentions([]);
    setReplyTo(null);
  }, [onSendMessage, roomId, isLoggedIn, sendOutbound, stopTyping, replyTo, clearDraft]);

  const handleInputChange = useCallback((content: string) => {
    setInputValue(content);
    if (content.trim()) {
      notifyTyping();
    } else {
      stopTyping();
    }
  }, [notifyTyping, stopTyping, setInputValue]);

  // ---- Composer edit session (ArrowUp flow) ----
  const handleRequestEditLast = useCallback(() => {
    for (let i = formattedMessages.length - 1; i >= 0; i--) {
      const m = formattedMessages[i];
      if (
        m.isMe &&
        !m.status &&
        m.eventId &&
        m.content?.trim() &&
        Date.now() - m.timestamp < EDIT_WINDOW_MS
      ) {
        setEditSession({ eventId: m.eventId, initialText: m.content });
        setInputValueLocal(m.content);
        return;
      }
    }
    // setInputValueLocal is a stable setter returned by the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formattedMessages]);

  const handleComposerEditSubmit = useCallback(async (text: string) => {
    if (!editSession) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setActionError(null);
    try {
      await editMutation.mutateAsync({
        roomId,
        eventId: editSession.eventId,
        body: trimmed,
      });
      setEditSession(null);
      clearDraft();
    } catch (err) {
      // Keep the edit session open so the user can retry.
      setActionError(err instanceof Error ? err.message : '编辑消息失败');
    }
  }, [editSession, editMutation, roomId, clearDraft]);

  const handleCancelEdit = useCallback(() => {
    setEditSession(null);
    setInputValueLocal('');
    // setInputValueLocal is stable (from the hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Drag-and-drop file upload (overlay on the whole room area) ----
  const { dragActive, dropZoneProps } = useFileDropZone({
    onFiles: (files) => {
      for (const file of files) handleFileUpload(file);
    },
  });

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

  // Worker options for the files panel. Team rooms lead with the team shared
  // workspace (agentteams layout: teams/{team}/shared/ — tasks/projects
  // produced by TeamHarness MCP) followed by the authoritative
  // `team.workerNames` roster (Matrix member lists may miss workers that
  // never spoke in the room due to lazy-loaded membership); other rooms fall
  // back to runtimeMap-resolved room members.
  const TEAM_SHARED_VALUE = '__team_shared__';
  const workerOptions = useMemo(() => {
    const byWorkerName = new Map(
      Object.values(runtimeMap).map((entry) => [entry.workerName, entry]),
    );
    const toOption = (workerName: string, userId?: string) => {
      const entry = byWorkerName.get(workerName) ?? (userId ? runtimeMap[userId] : undefined);
      if (!entry) return null;
      const runtimeLabel = RUNTIME_LABELS[entry.runtime] || entry.runtime;
      return {
        userId: userId ?? `worker:${workerName}`,
        workerName,
        label: `${workerName} · ${runtimeLabel}`,
      };
    };
    const teamOption = team
      ? { userId: TEAM_SHARED_VALUE, workerName: TEAM_SHARED_VALUE, label: `团队共享空间 · teams/${team.name}/shared` }
      : null;
    const workerEntries: { userId: string; workerName: string; label: string }[] = [];
    if (team?.workerNames?.length) {
      const mxidByWorkerName = new Map(
        roomMembers
          .map((m) => (runtimeMap[m.userId] ? ([runtimeMap[m.userId].workerName, m.userId] as const) : null))
          .filter((x): x is readonly [string, string] => x !== null),
      );
      for (const name of team.workerNames) {
        const opt = toOption(name, mxidByWorkerName.get(name));
        if (opt) workerEntries.push(opt);
      }
    } else {
      for (const m of roomMembers) {
        if (!runtimeMap[m.userId]) continue;
        const opt = toOption(runtimeMap[m.userId].workerName, m.userId);
        if (opt) workerEntries.push(opt);
      }
    }
    return teamOption ? [teamOption, ...workerEntries] : workerEntries;
  }, [team, roomMembers, runtimeMap]);

  // Team rooms open on the shared workspace (the team's own space); worker
  // rooms keep their owning worker; other rooms fall back to the first option.
  const effectiveSelectedWorker =
    selectedWorker
    ?? (team ? TEAM_SHARED_VALUE : undefined)
    ?? defaultWorkerName
    ?? workerOptions[0]?.workerName
    ?? null;
  const selectedIsTeamShared = effectiveSelectedWorker === TEAM_SHARED_VALUE;

  // "查看工作目录" on an agent bubble: open the worker files panel with that
  // message's sender pre-selected (resolved via the runtime map).
  const handleOpenWorkerFiles = useCallback((message: DisplayMessage) => {
    const workerName = message.workerName || runtimeMap[message.sender]?.workerName;
    if (!workerName) return;
    setSelectedWorker(workerName);
    setShowMembers(false);
    setShowWorkers(true);
  }, [runtimeMap]);

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
           <span className="text-xs font-semibold text-primary-foreground">{roomName.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="font-semibold text-sm truncate">{roomName}</h3>
          {workerMatrixUserIds && workerMatrixUserIds.length > 0
            ? sessionDot.runningOnly
              ? sessionDot.state === 'running'
                ? <WorkerSessionDot state="running" />
                : null
              : <WorkerSessionDot state={sessionDot.state} />
            : null}
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="实时同步" />
          {roomPhase && (
            <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 shrink-0">
              {roomPhase}
            </Badge>
          )}
          {roomRuntime && (
            <Badge variant="secondary" className="text-[11px] px-1 py-0 h-4 shrink-0">
              {RUNTIME_LABELS[roomRuntime] || roomRuntime}
            </Badge>
          )}
        </div>
        {team ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <span className="inline-flex items-center gap-1 shrink-0">
              <Users className="w-3 h-3" />
              {team.teamName || team.name}
            </span>
            {team.description && (
              <span className="truncate" title={team.description}>{team.description}</span>
            )}
            <span className="shrink-0 inline-flex items-center gap-1" title="就绪 Worker / 总 Worker">
              <UserCheck className="w-3 h-3 text-emerald-500" />
              {team.readyWorkers}/{team.totalWorkers}
            </span>
            {team.leaderName && (
              <span className="shrink-0">Leader: {team.leaderName}</span>
            )}
          </div>
        ) : (
          topic && (
            <p className="text-xs text-muted-foreground truncate">{topic}</p>
          )
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
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 shrink-0"
        onClick={() => {
          if (showWorkers) {
            setShowWorkers(false);
            setSelectedWorker(null);
          } else {
            setShowWorkers(true);
            setShowMembers(false);
          }
        }}
        title={showWorkers ? '隐藏工作目录' : '显示工作目录'}
      >
        <FolderTree className="w-4 h-4" />
      </Button>
    </div>
  ), [roomName, team, topic, avatar, roomMembers.length, showMembers, showWorkers, roomPhase, roomRuntime, workerMatrixUserIds, sessionDot.state, sessionDot.runningOnly]);

  return (
    <div
      ref={chatLayoutRef}
      className={`flex h-full relative ${isResizingWorkerPane ? 'select-none' : ''} ${className}`}
      onDragEnter={dropZoneProps.onDragEnter}
      onDragOver={dropZoneProps.onDragOver}
      onDragLeave={dropZoneProps.onDragLeave}
      onDrop={dropZoneProps.onDrop}
    >
      {/* Drag-and-drop upload overlay */}
      <DragDropOverlay
        active={dragActive}
        label="松开以上传文件"
        description={`支持多文件，发送到 ${roomName}`}
      />
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {header}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {showLoadErrorBanner && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-600 dark:text-red-400 shrink-0">
              <span className="truncate flex-1">{messagesLoadError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-2 shrink-0 hover:text-red-700"
                onClick={() => {
                  void messagesQuery.refetch();
                }}
              >
                重试
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 shrink-0 hover:text-red-700"
                onClick={() => setDismissedLoadError(messagesQuery.error)}
              >
                <PanelRightClose className="w-3 h-3" />
              </Button>
            </div>
          )}
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
            onOpenWorkerFiles={handleOpenWorkerFiles}
            memberMap={memberMap}
            onAtBottomChange={handleAtBottomChange}
            notices={systemNotices}
            onRetryNotice={handleRetryNotice}
            onDismissNotice={removeSystemNotice}
            readReceipts={readReceipts}
            currentUserId={currentUserId}
            senderStatusMap={senderStatusMap}
            onOpenWorkerChats={handleOpenWorkerChats}
            className="flex-1 min-h-0"
          />
          {/* C (#1295): worker 会话只读面板——头像点击开（「补头」入口；
              内容 = 会话列表 → agent 上下文详情；404 版本门占位） */}
          <Dialog
            open={chatsWorkerName !== null}
            onOpenChange={(o) => {
              if (!o) setChatsWorkerName(null);
            }}
          >
            <DialogContent className="w-full max-w-[min(100%-2rem,56rem)]">
              <DialogHeader>
                <DialogTitle>Worker 会话 — {chatsWorkerName}</DialogTitle>
                <DialogDescription>
                  只读：该 Worker 的 QwenPaw 会话（Agent 上下文，可能含压缩历史与未发送的工具输出）。
                </DialogDescription>
              </DialogHeader>
              {chatsWorkerName && <WorkerChatsPanel workerName={chatsWorkerName} />}
            </DialogContent>
          </Dialog>
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
          <AgentActivityTrack roomId={roomId} />
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
            editSession={editSession}
            onSubmitEdit={handleComposerEditSubmit}
            onCancelEdit={handleCancelEdit}
            onRequestEditLast={handleRequestEditLast}
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
                  <span className="relative inline-flex shrink-0">
                    <Avatar className="w-6 h-6 shrink-0">
                      <AvatarFallback className={`text-[10px] ${color}`}>
                        {member.displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {/* A17（9/19）：成员列表头像角落状态灯（与消息头像同款
                        WorkerSessionCornerDot；人类成员无映射不显）。 */}
                    {senderStatusMap[member.userId] && (
                      <WorkerSessionCornerDot state={senderStatusMap[member.userId]} ringClassName="ring-card" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{member.displayName}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {member.userId.split(':')[0].slice(1)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Workers files sidebar */}
      {showWorkers && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={256}
            aria-valuemax={600}
            aria-valuenow={Math.round(workerPaneWidth)}
            tabIndex={0}
            className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/60 focus:bg-primary/60 focus:outline-none max-md:hidden"
            onPointerDown={(event) => {
              event.preventDefault();
              setIsResizingWorkerPane(true);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const step = event.shiftKey ? 32 : 8;
              // Pane is on the right: ArrowLeft drags the edge left (wider).
              const delta = event.key === 'ArrowLeft' ? step : -step;
              setWorkerPaneWidth((w) => Math.min(600, Math.max(256, w + delta)));
            }}
          />
          <div
            className="shrink-0 border-l border-border bg-card overflow-hidden flex flex-col
              max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:shadow-xl max-md:max-w-[85vw]"
            style={{ width: workerPaneWidth }}
          >
            <div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
              <h4 className="font-semibold text-xs">工作目录</h4>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { setShowWorkers(false); setSelectedWorker(null); }}>
                <PanelRightClose className="w-3 h-3" />
              </Button>
            </div>
            {team && (
              <div className="px-3 pt-2 pb-1 border-b border-border shrink-0">
                <p className="text-[10px] leading-none text-muted-foreground">
                  当前任务文件存放在「{team.teamName} 的团队共享空间」(teams/{team.name}/shared/)
                </p>
              </div>
            )}
            <div className="p-2 border-b border-border">
              <Select
                value={effectiveSelectedWorker || ''}
                onValueChange={(v) => setSelectedWorker(v || null)}
              >
                <SelectTrigger className="w-full h-7 text-xs" aria-label="选择 Worker">
                  <SelectValue placeholder={workerOptions.length === 0 ? '暂无可用的 Worker' : '选择 Worker'} />
                </SelectTrigger>
                <SelectContent>
                  {workerOptions.map((w) => (
                    <SelectItem key={w.userId} value={w.workerName}>{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {effectiveSelectedWorker ? (
              <div className="flex-1 overflow-hidden">
                {/* key resets prefix/selection when the target changes */}
                <FilesBrowserPanel
                  key={effectiveSelectedWorker}
                  kind={selectedIsTeamShared ? 'team' : 'worker'}
                  ownerName={selectedIsTeamShared ? (team?.name ?? '') : effectiveSelectedWorker}
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-4">
                <p className="text-xs text-muted-foreground text-center">
                  {workerOptions.length === 0
                    ? team
                      ? '团队暂无已注册的 Worker'
                      : '当前房间没有 AgentTeams Worker 成员'
                    : '选择一个目标查看文件'}
                </p>
              </div>
            )}
          </div>
        </>
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
