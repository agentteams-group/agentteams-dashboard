// React Query hooks for Matrix Client-Server API
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { matrixApi, type MatrixEvent } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import type { WorkflowPayload } from '@/lib/a2ui/workflow';
import type { FileRef } from '@/lib/file-refs';
import type { ParsedA2uiBlock } from '@/lib/a2ui/parser';
import type { WorkerRuntime } from '@/lib/agentteams-api';
import type { ChatTurnState } from '@/lib/chat-ir/types';
import { create } from 'zustand';
import { consumeBufferedEvents } from '@/lib/matrix-sync-buffer';
import { recordSearchProbe } from '@/lib/matrix-capabilities';
import { useRuntimeMap, useHumanMatrixIds } from '@/components/dashboard/sections/chat/runtime-map-context';
import { SESSION_RECEIPT_TYPE } from '@/lib/message-read-status';
import {
  formatMatrixEvent,
  formatMatrixEvents,
  isMatrixAgentStatus,
  mergeAnswerFragments,
} from './matrix-message-format';

export { formatMatrixEvent, formatMatrixEvents, isMatrixAgentStatus, mergeAnswerFragments };

// Helper to get Matrix connection params
function useMatrixParams() {
  const { homeserver, accessToken, isLoggedIn, userId } = useMatrixStore();
  return { homeserver, accessToken, isLoggedIn, userId };
}

// ============ Typing Users Store ============

interface TypingUser {
  userId: string;
  displayName: string;
}

interface TypingStore {
  typingUsers: Record<string, TypingUser[]>;
  setTypingUsers: (_roomId: string, _users: TypingUser[]) => void;
  clearExpired: () => void;
  expiryMap: Record<string, number>;
}

export const useTypingStore = create<TypingStore>()((set, get) => ({
  typingUsers: {},
  expiryMap: {},
  setTypingUsers: (roomId: string, users: TypingUser[]) => {
    set((state) => ({
      typingUsers: { ...state.typingUsers, [roomId]: users },
      expiryMap: { ...state.expiryMap, [roomId]: Date.now() + 15000 }, // Expire after 15s
    }));
  },
  clearExpired: () => {
    const now = Date.now();
    const { expiryMap, typingUsers } = get();
    const newTyping: Record<string, TypingUser[]> = {};
    const newExpiry: Record<string, number> = {};
    for (const [roomId, expiry] of Object.entries(expiryMap)) {
      if (expiry > now) {
        newTyping[roomId] = typingUsers[roomId] || [];
        newExpiry[roomId] = expiry;
      }
    }
    set({ typingUsers: newTyping, expiryMap: newExpiry });
  },
}));

// ============ Room Messages (Infinite Scroll) ============

/** Latest read position of a user in a room (from m.read receipts). */
export interface ReadReceiptEntry {
  eventId: string;
  ts: number;
  eventTimestamp?: number;
  threadId?: string;
}

interface ReceiptStore {
  /** roomId -> userId -> latest m.read receipt. */
  receipts: Record<string, Record<string, ReadReceiptEntry>>;
  setRoomReceipts: (_roomId: string, _receipts: Record<string, ReadReceiptEntry>) => void;
}

export const useReceiptStore = create<ReceiptStore>()((set) => ({
  receipts: {},
  setRoomReceipts: (roomId: string, receipts: Record<string, ReadReceiptEntry>) =>
    set((state) => ({
      receipts: { ...state.receipts, [roomId]: receipts },
    })),
}));

/**
 * Room-level meta derived from /sync:
 *  - latest message timestamp (used to sort room list with newest on top)
 *  - unread counts from unread_notifications
 *
 * Stored in a small zustand store so that any code with the room id can
 * read these without re-running React Query per sidebar item.
 */
export interface RoomMeta {
  lastMessageTs?: number;
  /** Latest timeline body preview for the sidebar (plain text, truncated). */
  lastMessagePreview?: string;
  unreadCount?: number;
  unreadHighlightCount?: number;
  updatedAt: number;
  /**
   * Epoch ms at which the user last marked this room as read locally.
   * Used to ignore stale `unread_notifications` from the homeserver for
   * a short grace period (some self-hosted homeservers don't reset the
   * counter on `m.fully_read` and keep returning the old count).
   */
  clearedAt?: number;
  /**
   * Room display name (m.room.name from /sync state or /rooms/{id}/state).
   * Lets the sidebar surface rooms with no AgentTeams resource behind them
   * (project rooms etc.) — previously invisible because buildRooms only
   * derives resource-backed rooms.
   */
  roomName?: string;
  /**
   * Joined member count (sync summary m.joined_member_count, refined by the
   * one-shot state pass). Drives the plugin-style 群组/私聊 sidebar filter.
   */
  memberCount?: number;
}

interface RoomMetaStore {
  meta: Record<string, RoomMeta>;
  /**
   * The room currently open in the chat panel (null when none is selected).
   * The global sync loop only merges timeline events into the message cache
   * for this room, so per-room updates never fight over the React Query
   * cache while the user switches conversations.
   */
  activeRoomId: string | null;
  setActiveRoomId: (_roomId: string | null) => void;
  setRoomMeta: (_roomId: string, _meta: Partial<Omit<RoomMeta, 'updatedAt' | 'clearedAt'>>) => void;
  clearUnread: (_roomId: string) => void;
  forgetRoom: (_roomId: string) => void;
}

/** How long after clearUnread we ignore stale unread counts from /sync. */
const UNREAD_GRACE_MS = 30_000;

export const useRoomMetaStore = create<RoomMetaStore>()((set) => ({
  meta: {},
  activeRoomId: null,
  setActiveRoomId: (roomId) => set(() => ({ activeRoomId: roomId })),
  setRoomMeta: (roomId, partial) =>
    set((state) => {
      const prev = state.meta[roomId] ?? { updatedAt: 0 };
      const next: RoomMeta = { ...prev, ...partial, updatedAt: Date.now() };

      // If the user just marked this room as read locally, ignore any
      // incoming non-zero unread counts from /sync until the grace
      // period elapses. lastMessageTs still flows through so the sidebar
      // recency sort remains accurate.
      if (prev.clearedAt && Date.now() - prev.clearedAt < UNREAD_GRACE_MS) {
        if ((partial.unreadCount ?? 0) > 0) delete next.unreadCount;
        if ((partial.unreadHighlightCount ?? 0) > 0) delete next.unreadHighlightCount;
      }

      if (
        prev.lastMessageTs === next.lastMessageTs &&
        prev.lastMessagePreview === next.lastMessagePreview &&
        prev.unreadCount === next.unreadCount &&
        prev.unreadHighlightCount === next.unreadHighlightCount &&
        // FUNC-02: a batch that only carries m.room.name (or a member-count
        // change) produces a patch with all four counters identical — it must
        // still be applied, otherwise room renames never reach the sidebar.
        prev.roomName === next.roomName &&
        prev.memberCount === next.memberCount
      ) {
        return state;
      }
      return { meta: { ...state.meta, [roomId]: next } };
    }),
  clearUnread: (roomId) =>
    set((state) => {
      const prev = state.meta[roomId];
      if (!prev || (prev.unreadCount === 0 && prev.unreadHighlightCount === 0)) {
        // Still stamp clearedAt so a future server-confirmed non-zero value
        // gets suppressed in the grace window.
        if (!prev?.clearedAt) {
          return {
            meta: {
              ...state.meta,
              [roomId]: {
                ...(prev ?? { updatedAt: 0 }),
                clearedAt: Date.now(),
                updatedAt: Date.now(),
              },
            },
          };
        }
        return state;
      }
      return {
        meta: {
          ...state.meta,
          [roomId]: {
            ...prev,
            unreadCount: 0,
            unreadHighlightCount: 0,
            clearedAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      };
    }),
  forgetRoom: (roomId) =>
    set((state) => {
      if (!(roomId in state.meta)) return state;
      const next = { ...state.meta };
      delete next[roomId];
      return { meta: next };
    }),
}));

/** Read-only accessor for a single room's meta. */
export function useRoomMeta(roomId: string | null): RoomMeta | undefined {
  return useRoomMetaStore((s) => (roomId ? s.meta[roomId] : undefined));
}

const EMPTY_RECEIPTS: Record<string, ReadReceiptEntry> = {};

/** Latest m.read receipts of every other user in a room. */
export function useMatrixReadReceipts(roomId: string | null): Record<string, ReadReceiptEntry> {
  const receipts = useReceiptStore((s) => s.receipts[roomId ?? ''] ?? EMPTY_RECEIPTS);
  return receipts;
}

/**
 * True when at least one other user has sent a read receipt at or past this
 * message (element-web-style "✓✓ read" indicator for my own messages).
 */
export function isMessageReadByOthers(
  message: Pick<DisplayMessage, 'isMe' | 'timestamp'>,
  currentUserId: string | null | undefined,
  receipts: Record<string, ReadReceiptEntry>
): boolean {
  if (!message.isMe || !currentUserId) return false;
  return Object.entries(receipts).some(
    ([userId, receipt]) =>
      userId !== currentUserId &&
      !receipt.threadId &&
      typeof receipt.eventTimestamp === 'number' &&
      Number.isFinite(receipt.eventTimestamp) &&
      receipt.eventTimestamp >= message.timestamp
  );
}

/**
 * Merge fresh raw timeline events into a messages `chunk` array in place
 * (shared by the /sync buffer replay below). Dedupe by event_id: edits
 * (m.replace) replace the existing event in place, new events are
 * prepended (page 0 is newest-first).
 */
function redactionTarget(event: MatrixEvent): string | null {
  if (event.type !== 'm.room.redaction') return null;
  if (typeof event.redacts === 'string' && event.redacts) return event.redacts;
  const fromContent = event.content?.['redacts'];
  return typeof fromContent === 'string' && fromContent ? fromContent : null;
}

function isRevisionOf(event: MatrixEvent, targetId: string): boolean {
  const relation = event.content?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  return relation?.rel_type === 'm.replace' && relation.event_id === targetId;
}

export function mergeRawEventsInto(
  chunk: MatrixEvent[],
  fresh: MatrixEvent[],
  options: { onUnknownRedaction?: () => void } = {},
): MatrixEvent[] {
  const redactedIds = new Set(
    fresh.map(redactionTarget).filter((target): target is string => Boolean(target)),
  );
  if (redactedIds.size > 0) {
    const known = new Set([...chunk, ...fresh].map((event) => event.event_id));
    for (const target of redactedIds) {
      const hasRevision = [...chunk, ...fresh].some((event) => isRevisionOf(event, target));
      if (!known.has(target) && !hasRevision) options.onUnknownRedaction?.();
    }
    const removed = (event: MatrixEvent) =>
      redactedIds.has(event.event_id) || [...redactedIds].some((target) => isRevisionOf(event, target));
    for (let i = chunk.length - 1; i >= 0; i--) {
      if (removed(chunk[i])) chunk.splice(i, 1);
    }
  }

  const idToIndex = new Map<string, number>();
  chunk.forEach((e, i) => {
    if (e.event_id) idToIndex.set(e.event_id, i);
  });
  // Two passes: replace edits in place first, then unshift new events once
  // (unshifting mid-loop would invalidate the index map).
  const newEvents: MatrixEvent[] = [];
  for (const event of fresh) {
    if (!event.event_id || event.type === 'm.room.redaction') continue;
    if (redactedIds.has(event.event_id)) continue;
    const relation = event.content?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
    if (relation?.rel_type === 'm.replace' && relation.event_id && redactedIds.has(relation.event_id)) continue;
    const i = idToIndex.get(event.event_id);
    if (i !== undefined) {
      chunk[i] = event;
    } else {
      newEvents.push(event);
    }
  }
  // Page 0 is newest-first; buffered /sync events arrive oldest-first, so
  // reverse the batch before prepending.
  if (newEvents.length > 0) chunk.unshift(...newEvents.reverse());
  return chunk;
}

/**
 * 房间内容全文检索（方案 v3 B-1）。
 *
 * 与消息分页不共用 queryKey：检索词变了不能把已加载的时间线刷掉。
 * `limit` 取 100 是给「命中很多但只想跳过去」的场景一次性多拿一些；再多靠 nextBatch。
 * 最少 2 个字符才发请求：单字在中文房间里几乎必然命中几十条，既慢又没用。
 */
export function useMatrixRoomSearch(
  roomId: string | null,
  term: string,
  options: { enabled?: boolean } = {},
) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();
  const trimmed = term.trim();

  return useQuery({
    queryKey: ['matrix-room-search', roomId, trimmed],
    queryFn: async () => {
      if (!homeserver || !accessToken || !roomId) return { hits: [], unsupported: false };
      const result = await matrixApi.searchRoomMessages(homeserver, accessToken, roomId, trimmed, {
        limit: 100,
      });
      // /search 关掉索引时返回的是错误码而不是空结果，所以只有真发过一次请求
      // 才拿得到确定答案；记下来给能力弹层（B-6）显示「已实测」。
      recordSearchProbe(result.unsupported, result.reason);
      return result;
    },
    enabled:
      options.enabled !== false &&
      isLoggedIn &&
      !!roomId &&
      !!homeserver &&
      !!accessToken &&
      trimmed.length >= 2,
    // 搜索是边打字边触发的，同一个房间同一个词短期内不再打上游。
    staleTime: 30000,
  });
}

/**
 * 跨房间消息检索（方案 v3 B-1 的延伸：命令面板里的 `message` 实体）。
 *
 * 与 useMatrixRoomSearch 的差别只有一处：不带房间约束，服务端在该用户已加入的
 * 全部房间里搜。命中项的房间从 `hit.event.room_id` 上取——`/search` 返回的事件
 * 自带这个字段，所以不需要为每条命中再发一次请求。
 */
export function useMatrixMessageSearch(term: string, options: { enabled?: boolean } = {}) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();
  const trimmed = term.trim();

  return useQuery({
    queryKey: ['matrix-message-search', trimmed],
    queryFn: () =>
      matrixApi
        .searchRoomMessages(homeserver ?? '', accessToken ?? '', null, trimmed, {
          limit: 20,
        })
        // 与房间内检索同一个口径：跑过一次就记下实测结论（B-6）。
        .then((result) => {
          recordSearchProbe(result.unsupported, result.reason);
          return result;
        }),
    enabled:
      options.enabled !== false &&
      isLoggedIn &&
      !!homeserver &&
      !!accessToken &&
      trimmed.length >= 2,
    staleTime: 30000,
  });
}

export function useMatrixRoomMessages(roomId: string | null) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();
  const queryClient = useQueryClient();

  return useInfiniteQuery({
    queryKey: ['matrix-messages', roomId],
    queryFn: async ({ pageParam }) => {
      if (!homeserver || !accessToken || !roomId) {
        return { chunk: [], start: '', end: '' };
      }
      const data = await matrixApi.getRoomMessages(homeserver, accessToken, roomId, {
        dir: 'b',
        limit: 50,
        from: pageParam as string | undefined,
      });
      data.chunk = data.chunk.filter((event) => event.type !== SESSION_RECEIPT_TYPE);
      // Element-style realtime: replay the /sync events that arrived while
      // this room had no message cache (buffered by useGlobalMatrixSync).
      // Only the first page (latest events) participates — history pages
      // fetched via "load more" are immutable.
      if (pageParam === undefined) {
        const buffered = consumeBufferedEvents(roomId);
        if (buffered.length > 0) {
          let unknownRedaction = false;
          data.chunk = mergeRawEventsInto(data.chunk, buffered, {
            onUnknownRedaction: () => { unknownRedaction = true; },
          });
          if (unknownRedaction) {
            // Mark stale without an immediate refetch of the same potentially
            // lagging timeline; the next room load reconciles the deletion.
            queryClient.invalidateQueries({
              queryKey: ['matrix-messages', roomId],
              exact: true,
              refetchType: 'none',
            });
          }
        }
      }
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.end || undefined,
    enabled: isLoggedIn && !!roomId && !!homeserver && !!accessToken,
    staleTime: 5000,
  });
}

// ============ Room Members ============

export function useMatrixRoomMembers(roomId: string | null) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();

  return useQuery({
    queryKey: ['matrix-members', roomId],
    queryFn: async () => {
      if (!homeserver || !accessToken || !roomId) return { chunk: [] };
      return matrixApi.getRoomMembers(homeserver, accessToken, roomId);
    },
    enabled: isLoggedIn && !!roomId && !!homeserver && !!accessToken,
    staleTime: 30000,
  });
}

// ============ Room State ============

export function useMatrixRoomState(roomId: string | null) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();

  return useQuery({
    queryKey: ['matrix-state', roomId],
    queryFn: async () => {
      if (!homeserver || !accessToken || !roomId) return [];
      return matrixApi.getRoomState(homeserver, accessToken, roomId);
    },
    enabled: isLoggedIn && !!roomId && !!homeserver && !!accessToken,
    staleTime: 60000,
  });
}



export function useMatrixSendMessage() {
  const queryClient = useQueryClient();
  const { homeserver, accessToken } = useMatrixParams();
  const runtimeMap = useRuntimeMap();
  const humanUserIds = useHumanMatrixIds();

  return useMutation({
    mutationFn: async ({ roomId, body, formattedBody, extra, mentions, relatesTo }: { roomId: string; body: string; formattedBody?: string; extra?: Record<string, unknown>; mentions?: { user_ids: string[] }; relatesTo?: { rel_type?: string; event_id?: string; 'm.in_reply_to'?: { event_id: string } } }) => {
      if (!homeserver || !accessToken) throw new Error('Not logged in to Matrix');
      return matrixApi.sendMessage(homeserver, accessToken, roomId, body, {
        trackReadStatus: true,
        agentUserIds: Object.keys(runtimeMap),
        humanUserIds,
        format: formattedBody ? 'org.matrix.custom.html' : undefined,
        formattedBody,
        mentions: mentions ?? extra?.['m.mentions'] as { user_ids: string[] } | undefined,
        relatesTo,
        ...extra,
      });
    },
    onSuccess: (_, variables) => {
      // Invalidate messages query to refetch
      queryClient.invalidateQueries({ queryKey: ['matrix-messages', variables.roomId] });
      // Thread replies must refresh the thread view too.
      if (variables.relatesTo?.rel_type === 'm.thread') {
        queryClient.invalidateQueries({ queryKey: ['matrix-thread', variables.roomId, variables.relatesTo.event_id] });
      }
    },
  });
}

// ============ Thread Messages ============

/**
 * Fetches the replies in a thread (relations of type m.thread pointing at the
 * root event). Used by ThreadPanel; thread replies are excluded from the main
 * timeline by formatMatrixEvents.
 */
export function useMatrixThreadMessages(roomId: string | null, threadId: string | null) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();

  return useQuery({
    queryKey: ['matrix-thread', roomId, threadId],
    queryFn: async () => {
      if (!homeserver || !accessToken || !roomId || !threadId) {
        return { chunk: [], next_batch: '' };
      }
      return matrixApi.getRoomRelations(homeserver, accessToken, roomId, threadId, 'm.thread', {
        limit: 50,
      });
    },
    enabled: isLoggedIn && !!roomId && !!threadId && !!homeserver && !!accessToken,
    staleTime: 5000,
  });
}

// ============ Read Marker (m.fully_read) ============

export function useMatrixReadMarker(roomId: string | null) {
  const { homeserver, accessToken, isLoggedIn, userId } = useMatrixParams();

  return useQuery({
    queryKey: ['matrix-read-marker', roomId],
    queryFn: async () => {
      if (!homeserver || !accessToken || !userId || !roomId) return { event_id: '' };
      return matrixApi.getReadMarker(homeserver, accessToken, userId, roomId);
    },
    enabled: isLoggedIn && !!roomId && !!userId && !!homeserver && !!accessToken,
    staleTime: 30000,
  });
}

export function useMatrixSetReadMarker() {
  const queryClient = useQueryClient();
  const { homeserver, accessToken, userId } = useMatrixParams();

  return useMutation({
    mutationFn: async ({ roomId, eventId }: { roomId: string; eventId: string }) => {
      if (!homeserver || !accessToken || !userId) return;
      return matrixApi.setReadMarker(homeserver, accessToken, userId, roomId, eventId);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matrix-read-marker', variables.roomId] });
    },
  });
}

/**
 * Sends an m.read receipt for a message. Best-effort: failures are logged and
 * never disturb the UI (the read position still flows through m.fully_read).
 */
export function useMatrixSendReadReceipt() {
  const { homeserver, accessToken } = useMatrixParams();

  return useMutation({
    mutationFn: async ({ roomId, eventId }: { roomId: string; eventId: string }) => {
      if (!homeserver || !accessToken) return;
      return matrixApi.sendReadReceipt(homeserver, accessToken, roomId, eventId);
    },
    onError: (err) => {
      console.warn('Failed to send read receipt:', err);
    },
  });
}

// ============ Edit / Redact Message Mutations ============

export function useMatrixEditMessage() {
  const queryClient = useQueryClient();
  const { homeserver, accessToken } = useMatrixParams();

  return useMutation({
    mutationFn: async ({ roomId, eventId, body, msgtype }: { roomId: string; eventId: string; body: string; msgtype?: string }) => {
      if (!homeserver || !accessToken) throw new Error('Not logged in to Matrix');
      return matrixApi.editMessage(homeserver, accessToken, roomId, eventId, body, { msgtype });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matrix-messages', variables.roomId] });
      queryClient.invalidateQueries({ queryKey: ['matrix-thread', variables.roomId] });
    },
  });
}

export function useMatrixRedactMessage() {
  const queryClient = useQueryClient();
  const { homeserver, accessToken } = useMatrixParams();

  return useMutation({
    mutationFn: async ({ roomId, eventId, reason }: { roomId: string; eventId: string; reason?: string }) => {
      if (!homeserver || !accessToken) throw new Error('Not logged in to Matrix');
      return matrixApi.redactMessage(homeserver, accessToken, roomId, eventId, reason);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matrix-messages', variables.roomId] });
      queryClient.invalidateQueries({ queryKey: ['matrix-thread', variables.roomId] });
    },
  });
}

// ============ Upload Media Mutation ============

export function useMatrixUploadMedia() {
  const { homeserver, accessToken } = useMatrixParams();

  return useMutation({
    mutationFn: async ({ roomId, file }: { roomId: string; file: File }) => {
      if (!homeserver || !accessToken) throw new Error('Not logged in to Matrix');
      return matrixApi.uploadMedia(homeserver, accessToken, roomId, file);
    },
  });
}

/**
 * Higher-level typing notifier that mirrors element-web behaviour:
 * - `notifyTyping()` starts (or refreshes) a typing notification and arms an
 *   idle timer that automatically sends `typing: false` after the user stops
 *   typing. It also throttles refresh notifications so we never send more
 *   than one `typing: true` per throttle window.
 * - `stopTyping()` immediately sends `typing: false` and disarms the timer.
 *
 * The caller MUST invoke `stopTyping()` on unmount / room switch so the
 * homeserver does not keep showing a stale "typing" state for up to 30s.
 */
export function useTypingNotification(roomId: string | null, options: { idleMs?: number; throttleMs?: number } = {}) {
  const { idleMs = 4000, throttleMs = 4000 } = options;
  const { homeserver, accessToken, userId, isLoggedIn } = useMatrixParams();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(0);
  const isTypingRef = useRef(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const send = useCallback((typing: boolean) => {
    if (!homeserver || !accessToken || !userId || !roomId || !isLoggedIn) return;
    matrixApi.sendTyping(homeserver, accessToken, roomId, userId, typing).catch(() => {
      // fire-and-forget
    });
  }, [homeserver, accessToken, userId, roomId, isLoggedIn]);

  const stopTyping = useCallback(() => {
    clearIdleTimer();
    if (isTypingRef.current) {
      isTypingRef.current = false;
      send(false);
    }
  }, [clearIdleTimer, send]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (!isTypingRef.current || now - lastSentRef.current >= throttleMs) {
      isTypingRef.current = true;
      lastSentRef.current = now;
      send(true);
    }
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      send(false);
    }, idleMs);
  }, [clearIdleTimer, send, idleMs, throttleMs]);

  // Stop typing on unmount / room switch
  useEffect(() => stopTyping, [stopTyping]);

  return { notifyTyping, stopTyping };
}

// ============ Typing Users Hook ============

const EMPTY_TYPING_USERS: TypingUser[] = [];

export function useMatrixTypingUsers(roomId: string): TypingUser[] {
  const { userId } = useMatrixParams();
  const typingUsers = useTypingStore((s) => s.typingUsers[roomId] ?? EMPTY_TYPING_USERS);

  // Clear expired typing indicators periodically
  useEffect(() => {
    const interval = setInterval(() => {
      useTypingStore.getState().clearExpired();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Filter out current user - memoize to avoid re-renders
  return useMemo(() => typingUsers.filter((u) => u.userId !== userId), [typingUsers, userId]);
}

// ============ Timeline Event Merge (real-time message updates) ============

/**
 * Merge m.room.message events from /sync timeline into the query cache for a
 * given room. Handles both new messages and m.replace edits (streaming updates).
 * Called from useGlobalMatrixSync to keep the message list fresh without full
 * refetch.
 */
export function mergeTimelineEvents(
  queryClient: ReturnType<typeof useQueryClient>,
  roomId: string,
  events: MatrixEvent[],
  currentUserId: string
): void {
  const cacheKey = ['matrix-messages', roomId];
  let existing = queryClient.getQueryData(cacheKey) as {
    pages: Array<{ chunk: MatrixEvent[] }>;
  } | undefined;
  if (!existing) return;

  const redactedIds = new Set(
    events.map(redactionTarget).filter((target): target is string => Boolean(target)),
  );
  if (redactedIds.size > 0) {
    const cachedEvents = existing.pages.flatMap((page) => page.chunk);
    const knownIds = new Set([...cachedEvents, ...events].map((event) => event.event_id));
    let unknownTarget = false;
    for (const target of redactedIds) {
      const hasRevision = [...cachedEvents, ...events].some((event) => isRevisionOf(event, target));
      if (!knownIds.has(target) && !hasRevision) unknownTarget = true;
    }
    const removed = (event: MatrixEvent) =>
      redactedIds.has(event.event_id) || [...redactedIds].some((target) => isRevisionOf(event, target));
    existing = {
      ...existing,
      pages: existing.pages.map((page) => ({
        ...page,
        chunk: page.chunk.filter((event) => !removed(event)),
      })),
    };
    // Cancel an older in-flight timeline fetch so it cannot restore a message
    // after this redaction has already removed it.
    void queryClient.cancelQueries({ queryKey: cacheKey });
    queryClient.setQueryData(cacheKey, existing);
    queryClient.invalidateQueries({ queryKey: ['matrix-thread', roomId], refetchType: 'none' });
    if (unknownTarget) {
      queryClient.invalidateQueries({ queryKey: cacheKey, exact: true, refetchType: 'none' });
    }
  }

  for (const event of events) {
    if (event.type !== 'm.room.message' || redactedIds.has(event.event_id)) continue;
    const formatted = formatMatrixEvent(event, currentUserId);
    if (!formatted) continue;

    const relation = event.content['m.relates_to'] as {
      rel_type?: string;
      event_id?: string;
    } | undefined;
    const rootId = relation?.rel_type === 'm.replace' ? relation.event_id : undefined;
    if (rootId && redactedIds.has(rootId)) continue;

    // Update the cache with the latest version of this message.
    const current = queryClient.getQueryData(cacheKey) as typeof existing;
    if (!current) continue;

    // Find which page contains this event and update it.
    const updatedPages = current.pages.map((page) => {
      const existingEventIds = new Set(page.chunk.map((e) => e.event_id));
      if (existingEventIds.has(event.event_id) || (rootId && existingEventIds.has(rootId))) {
        return { ...page, chunk: [...page.chunk.filter((e) => e.event_id !== event.event_id && e.event_id !== rootId), event] };
      }
      return page;
    });

    // Also add the event if it's new (not in any existing page).
    const allEventIds = new Set(current.pages.flatMap((p) => p.chunk.map((e) => e.event_id)));
    const isNew = !allEventIds.has(event.event_id);
    const isRootNew = rootId ? !allEventIds.has(rootId) : false;
    if ((isNew && !rootId) || (rootId && isRootNew)) {
      updatedPages[0] = { ...updatedPages[0], chunk: [event, ...updatedPages[0].chunk] };
    }

    queryClient.setQueryData(cacheKey, { ...current, pages: updatedPages });
  }
}

// ============ Login Mutation ============

export function useMatrixLogin() {
  const login = useMatrixStore((s) => s.login);
  return useMutation({
    mutationFn: async ({ homeserver, username, password }: { homeserver: string; username: string; password: string }) => {
      const success = await login(homeserver, username, password);
      if (!success) throw new Error('Login failed');
      return true;
    },
  });
}

// ============ Helper: Format Matrix event for display ============

export interface RoomMember {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  membership: string;
}

export interface DisplayMessage {
  id: string;
  sender: string;
  senderShort: string;
  content: string;
  formattedContent?: string;
  timestamp: number;
  type: string;
  isMe: boolean;
  status?: 'sending' | 'sent' | 'error';
  mediaUrl?: string;
  mediaInfo?: { mimetype?: string; size?: number; w?: number; h?: number };
  /** Workspace file references attached to this message (optimistic local sends). */
  fileRefs?: FileRef[];
  /** Whether this message is still being streamed (AI response in progress) */
  isStreaming?: boolean;
  /** Agent run status from org.agentteams.status / content.status (streaming, in_progress, success, failed...). */
  agentStatus?: string;
  /** Structured AgentTeams workflow data attached to this Matrix event. */
  workflow?: WorkflowPayload;
  /** Structured blocks for an Agent run, retained across streaming revisions. */
  agentBlocks?: ParsedA2uiBlock[];
  /**
   * Display-only blocks aggregated by the worker turn grouper. When present
   * MessageBubble renders them directly instead of re-normalizing `content`
   * (the turn spans several Matrix events).
   */
  precomputedBlocks?: ParsedA2uiBlock[];
  /** Matrix event ids folded into this display message (read-marker lookup). */
  sourceEventIds?: string[];
  /** Original event.content (after m.replace merge), for normalizeToBlocks. */
  rawContent?: Record<string, unknown>;
  /** Root event ID if this message is a reply in a thread. */
  threadId?: string;
  /** Whether this message is itself a thread reply (not the root). */
  isThreadReply?: boolean;
  /** Number of replies in thread */
  replyCount?: number;
  /** Matrix event targeted by a quoted reply in the current room. */
  replyToEventId?: string;
  /** Whether this message has been edited */
  isEdited?: boolean;
  /** Number of m.replace revisions merged into this message (edit-chain count). */
  revisionCount?: number;
  /** Runtime owning the sender (stamped by ChatRoom from the MXID → Worker map). */
  runtime?: WorkerRuntime | null;
  /** Worker name owning the sender MXID, when known (tool-call counting). */
  workerName?: string;
  /** Original event ID for edit/delete (for m.room.redaction) */
  eventId?: string;
  /** ChatIR turn this message belongs to (folded turns carry their root id). */
  turnId?: string;
  /** How ChatIR judges the turn at render time (display only, never membership). */
  turnState?: ChatTurnState;
  /** Reply anchor: the root event a thread participates in (or own event). */
  canonicalEventId?: string;
  /** Latest raw Matrix event of this turn (edit revisions included) — m.fully_read. */
  latestEventId?: string;
  /** Latest non-thread raw event of the room — m.read receipt target. */
  latestTopLevelEventId?: string;
  /** Thread reply whose root is outside the loaded window. */
  detached?: boolean;
  /** MXIDs that participated in this thread (root + replies). */
  threadParticipants?: string[];
  /** Optional structured run id (org.agentteams.run.run_id). */
  runId?: string;
}
