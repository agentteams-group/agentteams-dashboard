import type { QueryClient } from '@tanstack/react-query';
import { matrixApi } from '@/lib/matrix-api';

/** Shared by room access and the global sync history loader. Keeping the key
 * in one place lets React Query deduplicate the two startup requests. */
export function chatRoomAccessQueryKey(
  homeserver: string | null,
  userId: string | null,
  syncGeneration: number,
) {
  return ['chat-room-access', homeserver, userId, syncGeneration] as const;
}

export function fetchChatRoomAccess(
  queryClient: QueryClient,
  homeserver: string,
  accessToken: string,
  userId: string | null,
  syncGeneration: number,
) {
  return queryClient.fetchQuery({
    queryKey: chatRoomAccessQueryKey(homeserver, userId, syncGeneration),
    queryFn: () => matrixApi.getJoinedRooms(homeserver, accessToken),
    staleTime: 15_000,
  });
}
