import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useMatrixStore } from '@/lib/matrix-store';
import { matrixApi } from '@/lib/matrix-api';
import { useChatRoomAccess } from './use-chat-room-access';

vi.mock('@/lib/matrix-api', () => ({ matrixApi: { getJoinedRooms: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  useMatrixStore.setState({ userId: '@one:test', homeserver: 'https://test', accessToken: 'memory-only', isLoggedIn: true, syncGeneration: 1 });
  vi.mocked(matrixApi.getJoinedRooms).mockResolvedValue({ joined_rooms: ['!one:test'] });
});
afterEach(cleanup);
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false, retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useChatRoomAccess(), { wrapper }), client };
}
describe('own-session Leader DM access', () => {
  it('does not infer membership while disconnected', () => {
    useMatrixStore.setState({ isLoggedIn: false });
    const { result } = setup();
    expect(result.current.state).toBe('disconnected');
    expect(matrixApi.getJoinedRooms).not.toHaveBeenCalled();
  });
  it('uses the current user token and keeps credentials out of the query key', async () => {
    const { result, client } = setup();
    expect(result.current.state).toBe('checking');
    await waitFor(() => expect(result.current.state).toBe('joined'));
    expect(result.current.joinedRooms).toEqual(['!one:test']);
    expect(matrixApi.getJoinedRooms).toHaveBeenCalledWith('https://test', 'memory-only');
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.queryKey))).not.toContain('memory-only');
  });
  it('does not reuse another account membership and removes access after a refresh failure', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe('joined'));
    vi.mocked(matrixApi.getJoinedRooms).mockResolvedValue({ joined_rooms: [] });
    act(() => useMatrixStore.setState({ userId: '@two:test', accessToken: 'another-token' }));
    expect(result.current.joinedRooms).toBeUndefined();
    await waitFor(() => expect(result.current.joinedRooms).toEqual([]));
    vi.mocked(matrixApi.getJoinedRooms).mockRejectedValue(new Error('temporarily unavailable'));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.state).toBe('error'));
  });
});
