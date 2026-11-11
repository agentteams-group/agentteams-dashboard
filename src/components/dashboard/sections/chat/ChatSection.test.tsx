// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api-error';

// --- Query hooks: controllable loading state -------------------------------
const hooksMock = vi.hoisted(() => ({
  useWorkers: vi.fn(),
  useTeams: vi.fn(),
  useManagers: vi.fn(),
  useHumans: vi.fn(),
  useRoomAccess: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({ userLevel: 3, userId: '@user:test', sessionUser: 'alice' }));
const taskFeedMock = vi.hoisted(() => ({ workflows: [] as unknown[] }));

vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: hooksMock.useWorkers }));
vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: hooksMock.useTeams }));
vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: hooksMock.useManagers }));
vi.mock('@/hooks/use-agentteams-humans', () => ({ useHumans: hooksMock.useHumans }));
vi.mock('@/hooks/use-chat-room-access', () => ({ useChatRoomAccess: hooksMock.useRoomAccess }));
vi.mock('@/hooks/use-assistant-task-feed', () => ({ useAssistantTaskFeed: () => ({ workflows: taskFeedMock.workflows, loading: false, degraded: false, partialError: false, refresh: vi.fn() }) }));

// --- Store hooks (no-selector call sites) -----------------------------------
vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: () => ({ isConnected: true, userLevel: sessionMock.userLevel, sessionUser: sessionMock.sessionUser }),
}));

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: () => ({ isLoggedIn: true, userId: sessionMock.userId, homeserver: 'https://test', logout: vi.fn() }),
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
  ChatPanel: ({ room, headerTitle, headerLeading }: { room: { id: string }; headerTitle?: ReactNode; headerLeading?: ReactNode }) => {
    chatPanelSpy.lastRoomId = room.id;
    return <div data-testid="chat-panel-stub">{headerLeading}{headerTitle}{room.id}</div>;
  },
}));

vi.mock('./chat-room-sidebar', () => ({
  ChatRoomSidebar: ({ footer, rooms, onSelectRoom }: { footer?: ReactNode; rooms: { id: string; name: string }[]; onSelectRoom: (_id: string) => void }) => (
    <div data-testid="sidebar-stub">{footer}{rooms.map(room => <button key={room.id} onClick={() => onSelectRoom(room.id)}>{room.name}</button>)}</div>
  ),
}));
vi.mock('./chat-auth-badge', () => ({ ChatAuthBadge: () => <div>MatrixAuth</div> }));
vi.mock('./sync-status-chip', () => ({ SyncStatusChip: () => <div>SyncChip</div> }));
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
import { conversationStorageKey } from './agent-conversations';
import { useSectionStore } from '@/lib/section-store';

beforeEach(() => {
  localStorage.clear();
  sessionMock.userId = '@user:test';
  taskFeedMock.workflows = [];
  hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!leader:test', '!ops:test', '!room1:test'], state: 'joined', refetch: vi.fn() });
});

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

function renderWithQueryClient(view: 'all' | 'assistants' | 'teams' = 'all') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatSection view={view} />
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
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!room1:test');
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

describe('role-based assistant landing', () => {
  beforeEach(() => {
    loaded();
    useHitlInboxStore.setState({ pendingChatRoomId: null });
    useRoomMetaStore.setState({ meta: {}, activeRoomId: null });
  });
  afterEach(() => { sessionMock.userLevel = 3; cleanup(); });

  it('opens the platform assistant for an admin', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test', matrixUserID: '@manager:test' }], isLoading: false });
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!ops:test');
    expect(useRoomMetaStore.getState().activeRoomId).toBe('!ops:test');
  });

  it('does not show a team chat merely because a global admin can list its resource', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'private-team', teamRoomID: '!private-group:test', leaderDMRoomID: '!private-leader:test' }], isLoading: false });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!ops:test'], state: 'joined', refetch: vi.fn() });
    renderWithQueryClient();
    fireEvent.click(screen.getByRole('button', { name: '打开空间列表' }));
    expect(screen.queryByText(/private-team/)).toBeNull();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!ops:test');
  });

  it('opens the accessible leader DM for a team user without loading global managers', () => {
    sessionMock.userLevel = 2;
    hooksMock.useManagers.mockReturnValue({ data: undefined, isLoading: false });
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', teamName: '设计团队', leaderName: 'leader', leaderDMRoomID: '!leader:test' }], isLoading: false });
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!leader:test');
    expect(useRoomMetaStore.getState().activeRoomId).toBe('!leader:test');
  });

  it('keeps an explicit worker deep link instead of replacing it with the default assistant', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    useHitlInboxStore.getState().setPendingChatRoomId(WORKER.roomID);
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent(WORKER.roomID);
  });

  it('lists controller project rooms by source_room_id even without Matrix room meta', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!ops:test', '!project:test'], state: 'joined', refetch: vi.fn() });
    taskFeedMock.workflows = [{
      project_id: 'project-1',
      title: '网站改版',
      status: 'active',
      team_id: 'design',
      source_room_id: '!project:test',
      nodes: [],
      edges: [],
      next: [],
      interrupts: [],
    }];
    renderWithQueryClient();
    fireEvent.click(screen.getByRole('button', { name: '打开空间列表' }));
    const sidebar = within(screen.getByTestId('sidebar-stub'));
    expect(sidebar.getByRole('button', { name: '网站改版' })).toBeInTheDocument();
  });

  it('restores the same account selection and gives an explicit deep link priority', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', leaderDMRoomID: '!leader:test' }], isLoading: false });
    localStorage.setItem(conversationStorageKey('https://test', '@user:test')!, '!leader:test');
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!leader:test');
    cleanup();
    useHitlInboxStore.getState().setPendingChatRoomId(WORKER.roomID);
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent(WORKER.roomID);
  });

  it('does not open an unjoined DM from a saved selection or deep link', () => {
    sessionMock.userLevel = 2;
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', leaderDMRoomID: '!leader:test' }], isLoading: false });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: [], state: 'joined', refetch: vi.fn() });
    localStorage.setItem(conversationStorageKey('https://test', '@user:test')!, '!leader:test');
    useHitlInboxStore.getState().setPendingChatRoomId('!leader:test');
    renderWithQueryClient();
    expect(screen.queryByTestId('chat-panel-stub')).toBeNull();
    expect(screen.queryByText('design')).toBeNull();
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!leader:test');
  });

  it('falls back when membership is revoked and keeps another account selection separate', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', leaderDMRoomID: '!leader:test' }], isLoading: false });
    localStorage.setItem(conversationStorageKey('https://test', '@user:test')!, '!leader:test');
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!leader:test');
    cleanup();
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!ops:test'], state: 'joined', refetch: vi.fn() });
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!ops:test');
    cleanup();
    sessionMock.userId = '@other:test';
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!leader:test', '!ops:test'], state: 'joined', refetch: vi.fn() });
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!ops:test');
  });
});

describe('separate assistants and my teams with mixed roles', () => {
  beforeEach(() => {
    loaded();
    sessionMock.userLevel = 2;
    useHitlInboxStore.setState({ pendingChatRoomId: null });
    hooksMock.useWorkers.mockReturnValue({ data: [], isLoading: false });
    hooksMock.useTeams.mockReturnValue({ data: ['a', 'b', 'c', 'd'].map((name, index) => ({
      name: `team-${name}`, teamName: `Team ${name.toUpperCase()}`, admin: { name: index < 2 ? 'alice' : 'bob' },
      teamRoomID: `!group-${name}:test`, leaderDMRoomID: `!dm-${name}:test`,
    })), isLoading: false });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!dm-a:test', '!dm-b:test', '!group-a:test', '!group-b:test', '!group-c:test', '!group-d:test'], state: 'joined', refetch: vi.fn() });
  });
  afterEach(() => { sessionMock.userLevel = 3; cleanup(); });

  it('shows only administered teams as private assistants', () => {
    renderWithQueryClient('assistants');
    fireEvent.click(screen.getByRole('button', { name: '打开空间列表' }));
    const sidebar = within(screen.getByTestId('sidebar-stub'));
    expect(sidebar.getByRole('button', { name: 'Team A助手' })).toBeInTheDocument();
    expect(sidebar.getByRole('button', { name: 'Team B助手' })).toBeInTheDocument();
    expect(sidebar.queryByRole('button', { name: /team-c|team-d/ })).toBeNull();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!dm-a:test');
    fireEvent.click(screen.getByRole('button', { name: '团队协作' }));
    expect(useSectionStore.getState().activeSection).toBe('my-teams');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!group-a:test');
  });

  it('shows every joined team, identifies each role, and opens ordinary member groups', async () => {
    renderWithQueryClient('teams');
    const sidebar = within(screen.getByTestId('sidebar-stub'));
    expect(sidebar.getAllByRole('button', { name: /team-[a-d] 团队房间/ })).toHaveLength(4);
    expect(screen.getByText('Team A · 管理员 · 团队协作')).toBeInTheDocument();
    fireEvent.click(sidebar.getByRole('button', { name: 'team-c 团队房间' }));
    await waitFor(() => expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!group-c:test'));
    expect(screen.getByText('Team C · 成员 · 团队协作')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '团队助手' })).toBeNull();
  });

  it('routes an existing group deep link into my teams without losing the target', () => {
    useHitlInboxStore.getState().setPendingChatRoomId('!group-c:test');
    renderWithQueryClient('assistants');
    expect(useSectionStore.getState().activeSection).toBe('my-teams');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!group-c:test');
  });
});

describe('project rooms in the teams view', () => {
  const projectWorkflow = {
    project_id: 'project-1',
    title: '网站改版',
    status: 'active',
    team_id: 'design',
    source_room_id: '!project:test',
    nodes: [],
    edges: [],
    next: [],
    interrupts: [],
  };

  beforeEach(() => {
    loaded();
    sessionMock.userLevel = 2;
    useHitlInboxStore.setState({ pendingChatRoomId: null });
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', teamName: '设计团队', teamRoomID: '!group:test', leaderDMRoomID: '!leader:test' }], isLoading: false });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!group:test', '!leader:test', '!project:test'], state: 'joined', refetch: vi.fn() });
    taskFeedMock.workflows = [projectWorkflow];
  });
  afterEach(() => { sessionMock.userLevel = 3; cleanup(); });

  it('includes project rooms in the teams view sidebar', () => {
    renderWithQueryClient('teams');
    const sidebar = within(screen.getByTestId('sidebar-stub'));
    expect(sidebar.getByRole('button', { name: /网站改版/ })).toBeInTheDocument();
    expect(sidebar.getByRole('button', { name: /design 团队房间/ })).toBeInTheDocument();
  });

  it('does not list project rooms in the assistants view', () => {
    renderWithQueryClient('assistants');
    fireEvent.click(screen.getByRole('button', { name: '打开空间列表' }));
    const sidebar = within(screen.getByTestId('sidebar-stub'));
    expect(sidebar.queryByRole('button', { name: /网站改版/ })).toBeNull();
  });

  it('routes a project deep link from the assistants view into my teams', () => {
    useHitlInboxStore.getState().setPendingChatRoomId('!project:test');
    renderWithQueryClient('assistants');
    expect(useSectionStore.getState().activeSection).toBe('my-teams');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!project:test');
  });
});

describe('ChatSection mobile room drawer', () => {
  beforeEach(() => {
    loaded();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens an accessible room drawer and closes it with Escape', async () => {
    renderWithQueryClient();
    expect(screen.queryByTestId('sidebar-stub')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '打开空间列表' }));
    expect(screen.getByTestId('sidebar-stub')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '切换对话' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '切换对话' })).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('sidebar-stub')).toBeNull());
    expect(screen.getByRole('button', { name: '打开空间列表' })).toHaveFocus();
  });
});

describe('ChatSection merged section chrome', () => {
  beforeEach(() => {
    loaded();
  });

  afterEach(() => {
    cleanup();
  });

  it('drops the standalone bar and parks the session cluster in the room list footer', () => {
    renderWithQueryClient();

    expect(screen.queryByText('Agent Chat')).toBeNull();
    expect(screen.queryByText('实时通信与人机协同')).toBeNull();

    expect(screen.queryByTestId('sidebar-stub')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开空间列表' }));
    const sidebar = screen.getByTestId('sidebar-stub');
    expect(within(sidebar).getByText('SyncChip')).toBeTruthy();
    expect(within(sidebar).getByText('MatrixAuth')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: '打开空间列表' }));
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
