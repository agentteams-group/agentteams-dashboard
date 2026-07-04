// React Query hooks for Matrix Client-Server API
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { matrixApi, MatrixEvent } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';

// Helper to get Matrix connection params
function useMatrixParams() {
  const { homeserver, accessToken, isLoggedIn } = useMatrixStore();
  return { homeserver, accessToken, isLoggedIn };
}

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
    mutationFn: async ({ roomId, body, formattedBody }: { roomId: string; body: string; formattedBody?: string }) => {
      if (!homeserver || !accessToken) throw new Error('Not logged in to Matrix');
      return matrixApi.sendMessage(homeserver, accessToken, roomId, body, {
        format: formattedBody ? 'org.matrix.custom.html' : undefined,
        formattedBody,
      });
    },
    onSuccess: (_, variables) => {
      // Invalidate messages query to refetch
      queryClient.invalidateQueries({ queryKey: ['matrix-messages', variables.roomId] });
    },
  });
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
  };
}
