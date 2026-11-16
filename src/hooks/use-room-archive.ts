import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matrixApi, type ArchivedRoomFilters } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';

export function useArchivedRooms(filters: ArchivedRoomFilters = {}, enabled = true) {
  const { homeserver, accessToken, userId, isLoggedIn, syncGeneration } = useMatrixStore();
  return useQuery({
    queryKey: ['archived-rooms', homeserver, userId, syncGeneration, filters],
    queryFn: () => matrixApi.getArchivedRooms(homeserver, accessToken, filters),
    enabled: enabled && isLoggedIn && !!homeserver && !!accessToken && !!userId,
    staleTime: 15000,
    refetchInterval: 30000,
    retry: false,
    throwOnError: false,
  });
}

export function useSetRoomArchived() {
  const { homeserver, accessToken } = useMatrixStore();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, archived }: { roomId: string; archived: boolean }) => matrixApi.setRoomArchived(homeserver, accessToken, roomId, archived),
    onSuccess: async (_data, { roomId }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['archived-rooms'] }),
        client.invalidateQueries({ queryKey: ['matrix-state', roomId] }),
      ]);
    },
  });
}

export function useDeleteArchivedRoom() {
  const { homeserver, accessToken } = useMatrixStore();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => matrixApi.deleteArchivedRoom(homeserver, accessToken, roomId),
    onSuccess: async (_data, roomId) => {
      client.removeQueries({ queryKey: ['matrix-messages', roomId] });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['archived-rooms'] }),
        client.invalidateQueries({ queryKey: ['chat-room-access'] }),
      ]);
    },
  });
}
