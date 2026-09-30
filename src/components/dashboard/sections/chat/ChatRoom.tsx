'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from './ChatStore';
import { MessageList } from './structures/MessageList';
import { ThreadPanel } from './structures/ThreadPanel';
import type { ScrollPanelHandle } from './structures/ScrollPanel';
import { usePersistedDraft } from './hooks/usePersistedDraft';
import { useFileUpload } from './hooks/useFileUpload';
import { useFileDropZone } from './hooks/useFileDropZone';
import { useOutboundMessages } from './hooks/useOutboundMessages';
import { useWorkerFileOptions } from './hooks/useWorkerFileOptions';
import { ChatRoomHeader } from './components/ChatRoomHeader';
import { MembersSidebar } from './components/MembersSidebar';
import { WorkersFilesSidebar } from './components/WorkersFilesSidebar';
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
import { useMatrixReadReceipts, useRoomMetaStore } from '@/hooks/use-matrix';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WorkerChatsPanel } from '@/components/dashboard/sections/workers/worker-chats-panel';
import { PanelRightClose, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatComposer, type MentionEntry } from './chat-composer';
import type { FileRef } from '@/lib/file-refs';
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
import { useRuntimeMap } from './runtime-map-context';
import type { TeamResponse } from '@/lib/agentteams-api';

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [showWorkers, setShowWorkers] = useState(false);
  // C (#1295): worker avatar click → read-only QwenPaw sessions dialog.
  const [chatsWorkerName, setChatsWorkerName] = useState<string | null>(null);
  const handleOpenWorkerChats = useCallback((name: string) => setChatsWorkerName(name), []);
  const [workerPaneWidth, setWorkerPaneWidth] = useState(320);
  const [isResizingWorkerPane, setIsResizingWorkerPane] = useState(false);
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

  // Outbound message cluster (optimistic bubbles + system notices + send),
  // extracted verbatim; markAllRead is injected because sending a message
  // advances the read position to the sent event.
  const {
    localMessages,
    systemNotices,
    pushLocal,
    patchLocal,
    removeLocal,
    pushSystemNotice,
    removeSystemNotice,
    sendOutbound,
    handleRetryNotice,
    buildSystemNotice: buildSystemNoticeFromError,
  } = useOutboundMessages({ roomId, isLoggedIn, userId, sendMutation, markAllRead });

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

  const handleSend = useCallback((content: string, _options?: { html?: boolean }, mentions?: MentionEntry[], fileRefs?: FileRef[]) => {
    const typed = content.trim();
    // A message may carry only file references (#87); it then falls back to a
    // short body so the send route's non-empty body contract still holds.
    if (!typed && !fileRefs?.length) return;
    let trimmed = typed || `引用 ${fileRefs?.length ?? 0} 个工作空间文件`;
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

    sendOutbound({ content: trimmed, options: _options, mentions, replyTo, msgtype, fileRefs });
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

  const {
    workerOptions,
    effectiveSelectedWorker,
    selectedIsTeamShared,
    setSelectedWorker,
  } = useWorkerFileOptions({ team, roomMembers, runtimeMap, defaultWorkerName });

  // Workspace space the composer can reference files from (#87): the selected
  // worker's private space, or the team's shared space when shared is selected
  // or no worker is resolvable in this room.
  const fileRefTarget = effectiveSelectedWorker && !selectedIsTeamShared
    ? { kind: 'worker' as const, ownerName: effectiveSelectedWorker }
    : team?.name
      ? { kind: 'team' as const, ownerName: team.name }
      : undefined;

  // "查看工作目录" on an agent bubble: open the worker files panel with that
  // message's sender pre-selected (resolved via the runtime map).
  const handleOpenWorkerFiles = useCallback((message: DisplayMessage) => {
    const workerName = message.workerName || runtimeMap[message.sender]?.workerName;
    if (!workerName) return;
    setSelectedWorker(workerName);
    setShowMembers(false);
    setShowWorkers(true);
  }, [runtimeMap, setSelectedWorker]);

  const handleOpenThread = useCallback((message: DisplayMessage) => {
    // A thread panel replaces the member list, element-web style.
    setShowMembers(false);
    setActiveThread(message);
  }, []);

  const handleToggleWorkersPanel = useCallback(() => {
    if (showWorkers) {
      setShowWorkers(false);
      setSelectedWorker(null);
    } else {
      setShowWorkers(true);
      setShowMembers(false);
    }
  }, [showWorkers, setSelectedWorker]);

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
        <ChatRoomHeader
          roomName={roomName}
          team={team}
          topic={topic}
          avatar={avatar}
          roomPhase={roomPhase}
          roomRuntime={roomRuntime}
          workerMatrixUserIds={workerMatrixUserIds}
          sessionDot={sessionDot}
          memberCount={roomMembers.length}
          showMembers={showMembers}
          showWorkers={showWorkers}
          onToggleMembers={() => setShowMembers(v => !v)}
          onToggleWorkers={handleToggleWorkersPanel}
        />
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
            <DialogContent className="w-full max-w-[min(100%-2rem,72rem)]">
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
            onSend={(refs) => handleSend(inputValue, undefined, mentions, refs)}
            isSending={sendMutation.isPending}
            sendError={sendMutation.error?.message ?? null}
            placeholder={replyTo ? `回复 ${replyTo.senderShort}... (Enter 发送)` : `发送消息到 ${roomName}... (Enter 发送, Shift+Enter 换行)`}
            disabled={!canSend || !isLoggedIn}
            members={roomMembers.map(m => ({ userId: m.userId, displayName: m.displayName }))}
            fileRefTarget={fileRefTarget}
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
        <MembersSidebar
          roomMembers={roomMembers}
          senderStatusMap={senderStatusMap}
          onClose={() => setShowMembers(false)}
        />
      )}

      {/* Workers files sidebar */}
      {showWorkers && (
        <WorkersFilesSidebar
          team={team}
          workerOptions={workerOptions}
          effectiveSelectedWorker={effectiveSelectedWorker}
          selectedIsTeamShared={selectedIsTeamShared}
          workerPaneWidth={workerPaneWidth}
          onPaneWidthChange={setWorkerPaneWidth}
          onResizeStart={() => setIsResizingWorkerPane(true)}
          onClose={() => { setShowWorkers(false); setSelectedWorker(null); }}
          onSelectWorker={setSelectedWorker}
        />
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
