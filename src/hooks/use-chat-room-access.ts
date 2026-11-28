import { useQuery } from '@tanstack/react-query';
import { matrixApi } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';
import { useShellPollingInterval } from '@/lib/shell-polling';
import { chatRoomAccessQueryKey } from '@/lib/chat-room-access-query';

export function useChatRoomAccess() {
  const { homeserver, accessToken, userId, isLoggedIn, syncGeneration } = useMatrixStore();
  const connected = Boolean(isLoggedIn && homeserver && accessToken && userId);
  const queryKey = chatRoomAccessQueryKey(homeserver, userId, syncGeneration);
  const query = useQuery({
    queryKey,
    queryFn: () => matrixApi.getJoinedRooms(homeserver, accessToken),
    enabled: connected,
    staleTime: 15000,
    refetchInterval: useShellPollingInterval(queryKey, 15_000),
    retry: 1,
  });
  const state: NonNullable<RoomInfo['access']> = !connected ? 'disconnected' : query.isError ? 'error' : query.data ? 'joined' : 'checking';
  return { joinedRooms: query.data?.joined_rooms, state, refetch: query.refetch };
}
