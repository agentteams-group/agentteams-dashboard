// React Query hooks for Matrix Client-Server API
import { useEffect, useMemo } from 'react';
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

// ============ Joined Rooms ============

export function useMatrixJoinedRooms() {
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();

  return useQuery({
    queryKey: ['matrix-joined-rooms'],
    queryFn: async () => {
      if (!homeserver || !accessToken) return { joined_rooms: [] };
      return matrixApi.getJoinedRooms(homeserver, accessToken);
    },
    enabled: isLoggedIn && !!homeserver && !!accessToken,
    staleTime: 30000,
    refetchInterval: 30000,
  });
}

// ============ Send Message Mutation ============

export function useMatrixSendMessage() {
  const queryClient = useQueryClient();
  const { homeserver, accessToken } = useMatrixParams();

  return useMutation({
    mutationFn: async ({ roomId, body, formattedBody, extra, mentions }: { roomId: string; body: string; formattedBody?: string; extra?: Record<string, unknown>; mentions?: { user_ids: string[] } }) => {
      if (!homeserver || !accessToken) throw new Error('Not logged in to Matrix');
      return matrixApi.sendMessage(homeserver, accessToken, roomId, body, {
        format: formattedBody ? 'org.matrix.custom.html' : undefined,
        formattedBody,
        mentions,
        ...extra,
      });
    },
    onSuccess: (_, variables) => {
      // Invalidate messages query to refetch
      queryClient.invalidateQueries({ queryKey: ['matrix-messages', variables.roomId] });
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

// ============ Send Typing Notification ============

export function useMatrixSendTyping() {
  const { homeserver, accessToken, userId } = useMatrixParams();

  return useMutation({
    mutationFn: async ({ roomId, typing }: { roomId: string; typing: boolean }) => {
      if (!homeserver || !accessToken || !userId) return;
      return matrixApi.sendTyping(homeserver, accessToken, roomId, userId, typing);
    },
  });
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
  const { homeserver, accessToken, isLoggedIn } = useMatrixParams();
  const setTypingUsers = useTypingStore((s) => s.setTypingUsers);

  useEffect(() => {
    if (!isLoggedIn || !homeserver || !accessToken || !roomId) return;

    let syncToken: string | undefined;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const resp = await matrixApi.sync(homeserver, accessToken, syncToken, 5000);
        if (cancelled) return;
        syncToken = resp.next_batch;

        // Process typing events from joined rooms
        const joinedRooms = resp.rooms?.join;
        if (joinedRooms) {
          for (const [rid, roomData] of Object.entries(joinedRooms)) {
            const ephemeralEvents = roomData.ephemeral?.events || [];
            for (const event of ephemeralEvents) {
              if (event.type === 'm.typing' && rid === roomId) {
                const typingUserIds = (event.content?.user_ids as string[]) || [];
                // Convert to TypingUser objects (we'll use userId as displayName for now)
                const users = typingUserIds.map((uid) => ({
                  userId: uid,
                  displayName: uid.startsWith('@') ? uid.split(':')[0].slice(1) : uid,
                }));
                setTypingUsers(rid, users);
              }
            }
          }
        }
      } catch {
        // Silently ignore sync errors for typing
      }

      if (!cancelled) {
        timeoutId = setTimeout(poll, 3000); // Poll every 3s for typing
      }
    };

    // Delay first poll to avoid synchronous state update during user interaction
    timeoutId = setTimeout(poll, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [homeserver, accessToken, isLoggedIn, roomId, setTypingUsers]);
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

// ============ Helper: Extract room name from state ============

export function getRoomNameFromState(stateEvents: { type: string; state_key: string; content: Record<string, unknown> }[]): string {
  const nameEvent = stateEvents.find(e => e.type === 'm.room.name');
  if (nameEvent?.content?.name) return nameEvent.content.name as string;

  const canonicalAlias = stateEvents.find(e => e.type === 'm.room.canonical_alias');
  if (canonicalAlias?.content?.alias) return canonicalAlias.content.alias as string;

  return '';
}

export function getRoomTopicFromState(stateEvents: { type: string; state_key: string; content: Record<string, unknown> }[]): string {
  const topicEvent = stateEvents.find(e => e.type === 'm.room.topic');
  return (topicEvent?.content?.topic as string) || '';
}

// ============ Helper: Format Matrix event for display ============

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
}

export function formatMatrixEvent(event: MatrixEvent, currentUserId: string): DisplayMessage | null {
  // Only display message events
  if (event.type !== 'm.room.message') return null;

  const senderShort = event.sender.startsWith('@')
    ? event.sender.split(':')[0].slice(1)
    : event.sender;

  return {
    id: event.event_id,
    sender: event.sender,
    senderShort,
    content: event.content.body || '',
    formattedContent: event.content.formatted_body,
    timestamp: event.origin_server_ts,
    type: event.content.msgtype || 'm.text',
    isMe: event.sender === currentUserId,
    mediaUrl: event.content.url as string | undefined,
    mediaInfo: event.content.info as { mimetype?: string; size?: number; w?: number; h?: number } | undefined,
  };
}
