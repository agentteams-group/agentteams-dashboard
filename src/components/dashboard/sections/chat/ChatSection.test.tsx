// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api-error';

// --- Query hooks: controllable loading state -------------------------------
const hooksMock = vi.hoisted(() => ({
  useWorkers: vi.fn(),
  useTeams: vi.fn(),
  useManagers: vi.fn(),
  useHumans: vi.fn(),
}));

vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: hooksMock.useWorkers }));
vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: hooksMock.useTeams }));
vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: hooksMock.useManagers }));
vi.mock('@/hooks/use-agentteams-humans', () => ({ useHumans: hooksMock.useHumans }));

// --- Store hooks (no-selector call sites) -----------------------------------
vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: () => ({ isConnected: true }),
}));

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: () => ({ isLoggedIn: true, userId: '@user:test', logout: vi.fn() }),
}));

// Room-members/state queries are irrelevant here; keep useRoomMetaStore real.
vi.mock('@/hooks/use-matrix', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-matrix')>('@/hooks/use-matrix');
  return {
    ...actual,
    useMatrixRoomMembers: () => ({ data: undefined, isLoading: false }),
    useMatrixRoomState: () => ({ data: undefined, isLoading: false }),
  };
});

// --- Heavy children: stub, but capture the selection ------------------------
const chatPanelSpy = vi.hoisted(() => ({ lastRoomId: null as string | null }));

vi.mock('./ChatPanel', () => ({
  ChatPanel: ({ room }: { room: { id: string } }) => {
    chatPanelSpy.lastRoomId = room.id;
    return <div data-testid="chat-panel-stub">{room.id}</div>;
  },
}));

vi.mock('./chat-room-sidebar', () => ({
  ChatRoomSidebar: () => <div data-testid="sidebar-stub" />,
}));
vi.mock('./chat-auth-badge', () => ({ ChatAuthBadge: () => <div /> }));
vi.mock('./sync-status-chip', () => ({ SyncStatusChip: () => <div /> }));
vi.mock('./chat-empty-state', () => ({ ChatEmptyState: () => <div data-testid="empty-stub" /> }));
vi.mock('./human-panel', () => ({ HumanPanel: () => <div /> }));
vi.mock('./room-topology', () => ({ RoomTopology: () => <div /> }));
vi.mock('./matrix-status-banner', () => ({ MatrixStatusBanner: () => <div /> }));
vi.mock('./ChatStore', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./runtime-map-context', () => ({
  RuntimeMapProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { ChatSection } from './ChatSection';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useRoomMetaStore } from '@/hooks/use-matrix';

const WORKER = {
  name: 'w1',
  team: 't1',
  matrixUserID: '@w1:test',
  roomID: '!room1:test',
  runtime: 'claude-code',
};

function loaded() {
  hooksMock.useWorkers.mockReturnValue({ data: [WORKER], isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooksMock.useTeams.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooksMock.useManagers.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooksMock.useHumans.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
}

function loading() {
  hooksMock.useWorkers.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
  hooksMock.useTeams.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooksMock.useManagers.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooksMock.useHumans.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
}

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatSection />
    </QueryClientProvider>,
  );
}

describe('ChatSection deep-link consumption (FUNC-04)', () => {
  beforeEach(() => {
    useHitlInboxStore.setState({ pendingChatRoomId: null, pendingProjectKey: null });
    useRoomMetaStore.setState({ meta: {}, activeRoomId: null });
    chatPanelSpy.lastRoomId = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('keeps the deep link alive while the room list is loading, then applies it', async () => {
    loading();
    useHitlInboxStore.getState().setPendingChatRoomId('!room1:test');

    const { rerender } = renderWithQueryClient();
    // Still loading: the pending value must NOT be consumed/dropped.
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!room1:test');

    // Room list arrives — the deep link must now take effect.
    loaded();
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChatSection />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    });
    expect(useRoomMetaStore.getState().activeRoomId).toBe('!room1:test');
    expect(screen.getByTestId('chat-panel-stub').textContent).toBe('!room1:test');
  });

  it('consumes an already-satisfiable deep link on first render', () => {
    loaded();
    useHitlInboxStore.getState().setPendingChatRoomId('!room1:test');

    renderWithQueryClient();
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(useRoomMetaStore.getState().activeRoomId).toBe('!room1:test');
  });

  it('keeps the pending value when the target room never exists', () => {
    loaded();
    useHitlInboxStore.getState().setPendingChatRoomId('!gone:test');

    renderWithQueryClient();
    // Unknown room: pending is retained (not silently eaten by a render).
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!gone:test');
  });
});

describe('ChatSection projection failure notices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHitlInboxStore.setState({ pendingChatRoomId: null, pendingProjectKey: null });
    useRoomMetaStore.setState({ meta: {}, activeRoomId: null });
    loaded();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an inline notice when managers projection fails, without hiding worker rooms', () => {
    hooksMock.useManagers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('API Error 403: forbidden', 403, '/managers'),
      refetch: vi.fn(),
    });

    renderWithQueryClient();
    expect(screen.getByText(/Managers 投影失败（403）/)).toBeTruthy();
    // The chat section must stay mounted (sidebar + empty state), not be
    // replaced by a full-page ApiErrorState.
    expect(screen.getAllByTestId('sidebar-stub').length).toBe(1);
    expect(screen.getByTestId('empty-stub')).toBeTruthy();
  });

  it('does not show a notice when every projection succeeds', () => {
    renderWithQueryClient();
    expect(screen.queryByRole('status', { name: /投影失败/ })).toBeNull();
    expect(screen.getByTestId('empty-stub')).toBeTruthy();
  });

  it('retries the failed projection when the notice button is clicked', () => {
    const refetch = vi.fn();
    hooksMock.useWorkers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch,
    });

    renderWithQueryClient();
    expect(screen.getByText(/Workers 投影失败/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(refetch).toHaveBeenCalled();
  });
});
