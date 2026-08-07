// React Query hooks for Matrix Client-Server API
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { matrixApi, MatrixEvent } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import { create } from 'zustand';

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
    ([userId, receipt]) => userId !== currentUserId && receipt.ts >= message.timestamp
  );
}

export function useMatrixRoomMessages(roomId: string | null) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();

  return useInfiniteQuery({
    queryKey: ['matrix-messages', roomId],
    queryFn: async ({ pageParam }) => {
      if (!homeserver || !accessToken || !roomId) {
        return { chunk: [], start: '', end: '' };
      }
      return matrixApi.getRoomMessages(homeserver, accessToken, roomId, {
        dir: 'b',
        limit: 50,
        from: pageParam as string | undefined,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.end || undefined,
    enabled: isLoggedIn && !!roomId && !!homeserver && !!accessToken,
    refetchInterval: 10000, // Poll every 10s for new messages
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

  return useMutation({
    mutationFn: async ({ roomId, body, formattedBody, extra, mentions, relatesTo }: { roomId: string; body: string; formattedBody?: string; extra?: Record<string, unknown>; mentions?: { user_ids: string[] }; relatesTo?: { rel_type?: string; event_id?: string; 'm.in_reply_to'?: { event_id: string } } }) => {
      if (!homeserver || !accessToken) throw new Error('Not logged in to Matrix');
      return matrixApi.sendMessage(homeserver, accessToken, roomId, body, {
        format: formattedBody ? 'org.matrix.custom.html' : undefined,
        formattedBody,
        mentions,
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
    refetchInterval: 10000, // Keep the thread live while it is open
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

// ============ Typing Sync (lightweight sync for typing notifications) ============

export function useTypingSync(roomId: string | null) {
  const queryClient = useQueryClient();
  const { homeserver, accessToken, isLoggedIn, userId } = useMatrixParams();
  const setTypingUsers = useTypingStore((s) => s.setTypingUsers);
  const setRoomReceipts = useReceiptStore((s) => s.setRoomReceipts);

  useEffect(() => {
    if (!isLoggedIn || !homeserver || !accessToken || !roomId) return;

    const generation = useMatrixStore.getState().syncGeneration;
    const isStale = () => useMatrixStore.getState().syncGeneration !== generation;

    let syncToken: string | undefined;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled || isStale()) return;
      try {
        const resp = await matrixApi.sync(homeserver, accessToken, syncToken, 25000);
        if (cancelled || isStale()) return;
        syncToken = resp.next_batch;

        const joinedRooms = resp.rooms?.join;
        if (joinedRooms) {
          for (const [rid, roomData] of Object.entries(joinedRooms)) {
            // Process ephemeral events (typing + receipts)
            const ephemeralEvents = roomData.ephemeral?.events || [];
            for (const event of ephemeralEvents) {
              if (rid !== roomId) continue;
              if (event.type === 'm.typing') {
                const typingUserIds = (event.content?.user_ids as string[]) || [];
                const users = typingUserIds.map((uid) => ({
                  userId: uid,
                  displayName: uid.startsWith('@') ? uid.split(':')[0].slice(1) : uid,
                }));
                setTypingUsers(rid, users);
              } else if (event.type === 'm.receipt') {
                const content = (event.content ?? {}) as Record<
                  string,
                  Record<string, Record<string, { ts?: number }> | undefined>
                >;
                const existing = useReceiptStore.getState().receipts[rid] ?? {};
                const next = { ...existing };
                for (const [eventId, relations] of Object.entries(content)) {
                  const readBy = relations?.['m.read'];
                  if (!readBy) continue;
                  for (const [uId, info] of Object.entries(readBy)) {
                    next[uId] = {
                      eventId,
                      ts: typeof info?.ts === 'number' ? info.ts : Date.now(),
                    };
                  }
                }
                setRoomReceipts(rid, next);
              }
            }

            // Process timeline events for real-time message updates
            const timelineEvents = roomData.timeline?.events || [];
            if (timelineEvents.length > 0 && rid === roomId) {
              mergeTimelineEvents(queryClient, rid, timelineEvents, userId);
            }
          }
        }
      } catch {
        // Silently ignore sync errors
      }

      if (!cancelled && !isStale()) {
        timeoutId = setTimeout(poll, 1000); // Poll every 1s for real-time updates
      }
    };

    timeoutId = setTimeout(poll, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [homeserver, accessToken, isLoggedIn, roomId, userId, setTypingUsers, setRoomReceipts, queryClient]);
}

// ============ Timeline Event Merge (real-time message updates) ============

/**
 * Merge m.room.message events from /sync timeline into the query cache for a
 * given room. Handles both new messages and m.replace edits (streaming updates).
 * Called from useTypingSync to keep the message list fresh without full refetch.
 */
export function mergeTimelineEvents(
  queryClient: ReturnType<typeof useQueryClient>,
  roomId: string,
  events: MatrixEvent[],
  currentUserId: string
): void {
  for (const event of events) {
    if (event.type !== 'm.room.message') continue;
    const formatted = formatMatrixEvent(event, currentUserId);
    if (!formatted) continue;

    const relation = event.content['m.relates_to'] as {
      rel_type?: string;
      event_id?: string;
    } | undefined;
    const rootId = relation?.rel_type === 'm.replace' ? relation.event_id : undefined;

    // Update the cache with the latest version of this message
    const cacheKey = ['matrix-messages', roomId];
    const existing = queryClient.getQueryData(cacheKey) as {
      pages: Array<{ chunk: MatrixEvent[] }>;
    } | undefined;

    if (!existing) continue;

    // Find which page contains this event and update it
    const updatedPages = existing.pages.map((page) => {
      const existingEventIds = new Set(page.chunk.map((e) => e.event_id));
      if (existingEventIds.has(event.event_id) || (rootId && existingEventIds.has(rootId))) {
        return { ...page, chunk: [...page.chunk.filter((e) => e.event_id !== event.event_id && e.event_id !== rootId), event] };
      }
      return page;
    });

    // Also add the event if it's new (not in any existing page)
    const allEventIds = new Set(existing.pages.flatMap((p) => p.chunk.map((e) => e.event_id)));
    const isNew = !allEventIds.has(event.event_id);
    const isRootNew = rootId ? !allEventIds.has(rootId) : false;
    if ((isNew && !rootId) || (rootId && isRootNew)) {
      updatedPages[0] = { ...updatedPages[0], chunk: [event, ...updatedPages[0].chunk] };
    }

    queryClient.setQueryData(cacheKey, { ...existing, pages: updatedPages });
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
  /** Whether this message is still being streamed (AI response in progress) */
  isStreaming?: boolean;
  /** Agent run status from org.agentteams.status / content.status (streaming, in_progress, success, failed...). */
  agentStatus?: string;
  /** Root event ID if this message is a reply in a thread (hidden from main timeline). */
  threadId?: string;
  /** Whether this message is itself a thread reply (not the root). */
  isThreadReply?: boolean;
  /** Number of replies in thread */
  replyCount?: number;
  /** Whether this message has been edited */
  isEdited?: boolean;
  /** Original event ID for edit/delete (for m.room.redaction) */
  eventId?: string;
}

function normalizeMatrixMessageBody(body: unknown): string {
  if (typeof body === 'string') return body;

  if (Array.isArray(body)) {
    return body
      .map(normalizeMatrixMessageBody)
      .filter(Boolean)
      .join('\n');
  }

  if (body && typeof body === 'object') {
    const text = (body as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
    return JSON.stringify(body) ?? '';
  }

  if (typeof body === 'number' || typeof body === 'boolean') return String(body);

  return '';
}

export function formatMatrixEvent(event: MatrixEvent, currentUserId: string): DisplayMessage | null {
  // Only display message events
  if (event.type !== 'm.room.message') return null;

  const senderShort = event.sender.startsWith('@')
    ? event.sender.split(':')[0].slice(1)
    : event.sender;

  // Redacted (deleted) messages have their content wiped by the homeserver;
  // treat them as gone so the timeline drops them instead of showing blanks.
  const rawContent = (event.content ?? {}) as MatrixEvent['content'];
  if (
    !rawContent.msgtype &&
    !rawContent.body &&
    !rawContent['m.relates_to']
  ) {
    return null;
  }

  // Edited messages (m.replace): render the replacement content instead of
  // the stale fallback body ("* ..."). The manager delivers final answers by
  // editing its "处理中..." placeholder, so without this the room shows the
  // edit fallback as a separate, ugly message.
  let content = rawContent;
  const relatesTo = content['m.relates_to'] as { rel_type?: string } | undefined;
  const isEdited = relatesTo?.rel_type === 'm.replace';
  if (isEdited) {
    const newContent = content['m.new_content'] as typeof content | undefined;
    if (newContent && typeof newContent === 'object') {
      content = { ...content, ...newContent };
    }
  }

  // A thread reply carries an m.thread relation pointing at the thread root.
  const threadRelation = content['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  const isThreadReply = threadRelation?.rel_type === 'm.thread';
  const threadRootId = isThreadReply ? threadRelation?.event_id : undefined;

  return {
    id: event.event_id,
    sender: event.sender,
    senderShort,
    content: normalizeMatrixMessageBody(content.body),
    formattedContent: content.formatted_body,
    timestamp: event.origin_server_ts,
    type: content.msgtype || 'm.text',
    isMe: event.sender === currentUserId,
    mediaUrl: content.url as string | undefined,
    mediaInfo: content.info as { mimetype?: string; size?: number; w?: number; h?: number } | undefined,
    isStreaming: isMatrixStreaming(content),
    agentStatus: isMatrixAgentStatus(content),
    isEdited,
    eventId: event.event_id,
    threadId: isThreadReply ? threadRootId : undefined,
    isThreadReply,
  };
}

function isMatrixStreaming(content: MatrixEvent['content']): boolean {
  const status = content['org.agentteams.status'] ?? content.status;
  return content['org.agentteams.streaming'] === true
    || content['m.streaming'] === true
    || content.streaming === true
    || status === 'streaming'
    || status === 'in_progress';
}

/** Agent run status badge value, e.g. `streaming`, `in_progress`, `success`, `failed`. */
export function isMatrixAgentStatus(content: MatrixEvent['content']): string | undefined {
  const status = content['org.agentteams.status'] ?? content.status;
  if (typeof status === 'string' && status.length > 0) return status;
  return undefined;
}

/**
 * Collapses Matrix message revisions into their root event so a streaming
 * response stays in one position while the homeserver publishes edits.
 *
 * Thread replies (m.thread relations) never render in the main timeline —
 * they are filtered out and their count is attached to the thread root so the
 * UI can show a "↩ N" thread summary badge. Full thread contents are fetched
 * on demand via the thread relations API (useMatrixThreadMessages).
 */
export function formatMatrixEvents(events: MatrixEvent[], currentUserId: string): DisplayMessage[] {
  const messages = new Map<string, DisplayMessage>();
  const pendingRevisions = new Map<string, DisplayMessage>();
  const replyCounts = new Map<string, number>();

  // Collect target ids of redaction events so deleted messages are dropped.
  const redactedIds = new Set<string>();
  for (const event of events) {
    if (event.type === 'm.room.redaction') {
      const redacts = (event as { redacts?: string }).redacts;
      if (redacts) redactedIds.add(redacts);
    }
  }

  for (const event of [...events].sort((a, b) => a.origin_server_ts - b.origin_server_ts)) {
    if (redactedIds.has(event.event_id)) continue;
    if (event.type === 'm.room.redaction') continue;

    const formatted = formatMatrixEvent(event, currentUserId);
    if (!formatted) continue;

    const relation = event.content['m.relates_to'] as {
      rel_type?: string;
      event_id?: string;
    } | undefined;
    const rootId = relation?.rel_type === 'm.replace' ? relation.event_id : undefined;

    if (rootId) {
      const root = messages.get(rootId);
      if (root) {
        // Re-render the root in place, but keep the original event id so read
        // markers and edits still resolve to the root event.
        messages.set(rootId, {
          ...formatted,
          id: rootId,
          eventId: rootId,
          timestamp: root.timestamp,
          isEdited: true,
        });
      } else {
        pendingRevisions.set(rootId, formatted);
      }
      continue;
    }

    // Thread replies stay out of the main timeline; just tally them.
    if (formatted.isThreadReply && formatted.threadId) {
      replyCounts.set(formatted.threadId, (replyCounts.get(formatted.threadId) ?? 0) + 1);
      continue;
    }

    const revision = pendingRevisions.get(event.event_id);
    messages.set(
      event.event_id,
      revision ? { ...revision, id: event.event_id, eventId: event.event_id, timestamp: formatted.timestamp } : formatted
    );
    pendingRevisions.delete(event.event_id);
  }

  for (const [rootId, revision] of pendingRevisions) {
    messages.set(rootId, { ...revision, id: rootId, eventId: rootId, isEdited: true });
  }

  const result = [...messages.values()];
  for (const message of result) {
    const count = replyCounts.get(message.id);
    if (count) message.replyCount = count;
  }

  return result.sort((a, b) => a.timestamp - b.timestamp);
}
