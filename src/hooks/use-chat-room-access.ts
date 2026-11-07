import { useQuery } from '@tanstack/react-query';
import { matrixApi } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';

export function useChatRoomAccess() {
  const { homeserver, accessToken, userId, isLoggedIn, syncGeneration } = useMatrixStore();
  const connected = Boolean(isLoggedIn && homeserver && accessToken && userId);
  const query = useQuery({
    queryKey: ['chat-room-access', homeserver, userId, syncGeneration],
    queryFn: () => matrixApi.getJoinedRooms(homeserver, accessToken),
    enabled: connected,
    staleTime: 15000,
    refetchInterval: 15000,
    retry: 1,
  });
  const state: NonNullable<RoomInfo['access']> = !connected ? 'disconnected' : query.isError ? 'error' : query.data ? 'joined' : 'checking';
  return { joinedRooms: query.data?.joined_rooms, state, refetch: query.refetch };
}
