// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api-error';
import type { RuntimeMap } from './runtime-map-context';
import { assembleChatTimeline } from '@/lib/chat-ir/assemble';
import { formatMatrixEvents } from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';

// --- Query hooks: controllable loading state -------------------------------
const hooksMock = vi.hoisted(() => ({
  useWorkers: vi.fn(),
  useTeams: vi.fn(),
  useManagers: vi.fn(),
  useHumans: vi.fn(),
  useRoomAccess: vi.fn(),
  useArchivedRooms: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({ isLoggedIn: true, userLevel: 3, userId: '@user:test', sessionUser: 'alice' }));
const taskFeedMock = vi.hoisted(() => ({ workflows: [] as unknown[] }));
const taskBoardMock = vi.hoisted(() => ({ tasks: [] as import('@/hooks/use-task-board').BoardTask[] }));

vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: hooksMock.useWorkers }));
vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: hooksMock.useTeams }));
vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: hooksMock.useManagers }));
vi.mock('@/hooks/use-agentteams-humans', () => ({ useHumans: hooksMock.useHumans }));
vi.mock('@/hooks/use-chat-room-access', () => ({ useChatRoomAccess: hooksMock.useRoomAccess }));
vi.mock('@/hooks/use-room-archive', () => ({ useArchivedRooms: hooksMock.useArchivedRooms }));
vi.mock('@/hooks/use-assistant-task-feed', () => ({ useAssistantTaskFeed: () => ({ workflows: taskFeedMock.workflows, loading: false, degraded: false, partialError: false, refresh: vi.fn() }) }));
vi.mock('@/hooks/use-projects', () => ({ useApiTaskBoard: () => taskBoardMock }));

// --- Store hooks (no-selector call sites) -----------------------------------
vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: () => ({ isConnected: true, userLevel: sessionMock.userLevel, sessionUser: sessionMock.sessionUser }),
}));

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: () => ({ isLoggedIn: sessionMock.isLoggedIn, userId: sessionMock.userId, homeserver: 'https://test', logout: vi.fn() }),
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
const chatPanelSpy = vi.hoisted(() => ({ lastRoomId: null as string | null, lastRoomName: null as string | null, runtimeMap: {} as RuntimeMap }));

vi.mock('./ChatPanel', () => ({
  ChatPanel: ({ room, headerTitle, headerLeading, headerActions }: { room: { id: string; name: string }; headerTitle?: ReactNode; headerLeading?: ReactNode; headerActions?: ReactNode }) => {
    chatPanelSpy.lastRoomId = room.id;
    chatPanelSpy.lastRoomName = room.name;
    return <div data-testid="chat-panel-stub">{headerLeading}{headerTitle}{headerActions}{room.id}</div>;
  },
}));

vi.mock('./chat-room-sidebar', () => ({
  InviteInbox: () => <div data-testid="invite-inbox-stub" />,
  ChatRoomSidebar: ({ footer, rooms, onSelectRoom }: { footer?: ReactNode; rooms: { id: string; name: string }[]; onSelectRoom: (_id: string) => void }) => (
    <div data-testid="sidebar-stub">{footer}{rooms.map(room => <button key={room.id} onClick={() => onSelectRoom(room.id)}>{room.name}</button>)}</div>
  ),
}));
vi.mock('./sync-status-chip', () => ({ SyncStatusChip: () => <div>SyncChip</div> }));
vi.mock('./chat-empty-state', () => ({ ChatEmptyState: () => <div data-testid="empty-stub" /> }));
vi.mock('./human-panel', () => ({ HumanPanel: () => <div /> }));
vi.mock('./room-topology', () => ({ RoomTopology: () => <div /> }));
vi.mock('./matrix-status-banner', () => ({ MatrixStatusBanner: ({ onLoginClick }: { onLoginClick: () => void }) => <button onClick={onLoginClick}>重新连接</button> }));
vi.mock('./matrix-login-form', () => ({ MatrixLoginForm: ({ onLoginSuccess }: { onLoginSuccess: () => void }) => <button onClick={onLoginSuccess}>完成连接</button> }));
vi.mock('./ChatStore', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./runtime-map-context', () => ({
  RuntimeMapProvider: ({ children, map }: { children: ReactNode; map: RuntimeMap }) => {
    chatPanelSpy.runtimeMap = map;
    return <>{children}</>;
  },
}));

import { ChatSection } from './ChatSection';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { conversationStorageKey } from './agent-conversations';
import { useSectionStore } from '@/lib/section-store';

beforeEach(() => {
  useSectionStore.setState({ taskCollaboration: null });
  localStorage.clear();
  sessionMock.userId = '@user:test';
  sessionMock.isLoggedIn = true;
  sessionMock.sessionUser = 'alice';
  taskFeedMock.workflows = [];
  taskBoardMock.tasks = [];
  hooksMock.useArchivedRooms.mockReturnValue({ data: { rooms: [] }, isSuccess: true });
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
  it('puts task room mentions under task board navigation regardless of their entry point', async () => {
    loaded();
    useRoomMetaStore.setState({ meta: { '!task:test': { roomName: 'TASK：p50-22-word-count', updatedAt: 0 } } });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!room1:test', '!task:test'], state: 'joined', refetch: vi.fn() });
    useSectionStore.setState({ activeSection: 'chat', mentionRoomId: '!task:test' });
    useHitlInboxStore.getState().setPendingChatRoomId('!task:test');
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><ChatSection view="assistants" /></QueryClientProvider>);
    await waitFor(() => expect(chatPanelSpy.lastRoomId).toBe('!task:test'));
    expect(useSectionStore.getState().taskCollaboration).toEqual({ taskId: 'p50-22-word-count', roomId: '!task:test' });
    view.rerender(<QueryClientProvider client={client}><ChatSection view="all" /></QueryClientProvider>);
    expect(chatPanelSpy.lastRoomId).toBe('!task:test');
    expect(useSectionStore.getState().mentionRoomId).toBe('!task:test');
    expect(screen.getByRole('button', { name: '返回任务看板' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /切换团队/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回任务看板' }));
    expect(useSectionStore.getState().activeSection).toBe('tasks');
  });
  it.each(['TASK：task-123', '用户自定义房间名'])('shows the task title while preserving a custom room name: %s', async roomName => {
    loaded();
    taskFeedMock.workflows = [];
    taskBoardMock.tasks = [{ runId: 'task-123', title: '离线问候页面', status: 'in_progress',
      executionRoomId: '!task:test', roomId: '!leader:test', assignedTo: 'leader', dependsOn: [],
      createdAt: 0, source: 'controller', outcome: null }];
    taskBoardMock.tasks.unshift({ ...taskBoardMock.tasks[0], runId: 'exec-123', parentTaskId: 'task-123', title: '开发节点' });
    useRoomMetaStore.setState({ meta: { '!task:test': { roomName, updatedAt: 0 } } });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!task:test'], state: 'joined', refetch: vi.fn() });
    useSectionStore.setState({ activeSection: 'chat', taskCollaboration: { taskId: 'task-123', roomId: '!task:test' } });
    renderWithQueryClient();
    await waitFor(() => expect(chatPanelSpy.lastRoomId).toBe('!task:test'));
    expect(screen.getByRole('navigation', { name: '任务协作导航' })).toHaveTextContent('离线问候页面/协作');
    expect(screen.getByTitle('task-123')).toHaveTextContent('离线问候页面');
    expect(chatPanelSpy.lastRoomName).toBe(roomName === 'TASK：task-123' ? '离线问候页面' : roomName);
    expect(useSectionStore.getState().taskCollaboration?.taskId).toBe('task-123');
  });
  it('shows task collaboration navigation and returns to the board without opening task details', async () => {
    loaded();
    useSectionStore.setState({ activeSection: 'chat', taskCollaboration: { taskId: 'task-123', roomId: '!room1:test' } });
    useHitlInboxStore.getState().setPendingChatRoomId('!room1:test');
    renderWithQueryClient();
    expect(screen.getByRole('navigation', { name: '任务协作导航' })).toHaveTextContent('task-123/协作');
    await waitFor(() => expect(chatPanelSpy.lastRoomId).toBe('!room1:test'));
    fireEvent.click(screen.getByRole('button', { name: '返回任务看板' }));
    expect(useSectionStore.getState().activeSection).toBe('tasks');
    expect(useSectionStore.getState().taskCollaboration).toBeNull();
    expect(useHitlInboxStore.getState().pendingProjectKey).toBeNull();
  });
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

  it('assembles Manager thinking, tools and its edited answer as one turn', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', runtime: 'qwenpaw', roomID: '!ops:test', matrixUserID: '@manager:test' }], isLoading: false });
    renderWithQueryClient();
    const events = [
      { event_id: 'root', origin_server_ts: 1000, content: { msgtype: 'm.notice', body: '处理中...' } },
      { event_id: 'think', origin_server_ts: 2000, content: { msgtype: 'm.notice', body: '先查看配置', 'm.relates_to': { rel_type: 'm.thread', event_id: 'root' } } },
      { event_id: 'tool', origin_server_ts: 3000, content: { msgtype: 'm.text', body: '🔧 **execute_shell_command**\n```json\n{"command":"pwd"}\n```', 'm.relates_to': { rel_type: 'm.thread', event_id: 'root' } } },
      { event_id: 'answer', origin_server_ts: 4000, content: { msgtype: 'm.text', body: '* 已完成', 'm.relates_to': { rel_type: 'm.replace', event_id: 'root' }, 'm.new_content': { msgtype: 'm.text', body: '已完成' } } },
    ].map(event => ({ ...event, sender: '@manager:test', type: 'm.room.message' })) as MatrixEvent[];
    const { messages } = assembleChatTimeline(formatMatrixEvents(events, '@user:test'), events, {
      currentUserId: '@user:test', runtimeMap: chatPanelSpy.runtimeMap,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'root', content: '已完成', turnState: 'finalized' });
    expect(messages[0].precomputedBlocks?.map(block => block.type)).toEqual(['thinking', 'tool_call', 'text']);
    expect(chatPanelSpy.runtimeMap['@w1:test']).toMatchObject({ workerName: 'w1' });
  });

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
    fireEvent.click(screen.getByRole('button', { name: '切换团队及任务房间' }));
    expect(screen.queryByText(/private-team/)).toBeNull();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!ops:test');
  });

  it('opens the accessible leader DM for a team user without loading global managers', () => {
    sessionMock.userLevel = 2;
    hooksMock.useManagers.mockReturnValue({ data: undefined, isLoading: false });
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', teamName: '设计团队', admin: { name: 'alice' }, leaderName: 'leader', leaderDMRoomID: '!leader:test' }], isLoading: false });
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
  it('opens a joined task execution room when legacy workflow metadata and Matrix names omit it', async () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!ops:test', '!task:test'], state: 'joined', refetch: vi.fn() });
    taskFeedMock.workflows = [];
    useHitlInboxStore.getState().setPendingChatRoomId('!task:test');
    renderWithQueryClient('assistants');
    await waitFor(() => expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!task:test'));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(useRoomMetaStore.getState().activeRoomId).toBe('!task:test');
  });

  it('does not synthesize an unjoined task room from a deep link', () => {
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: [], state: 'joined', refetch: vi.fn() });
    useHitlInboxStore.getState().setPendingChatRoomId('!unjoined-task:test');
    renderWithQueryClient('assistants');
    expect(screen.queryByTestId('chat-panel-stub')).toBeNull();
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!unjoined-task:test');
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
    fireEvent.click(screen.getByRole('button', { name: '切换团队及任务房间' }));
    const sidebar = within(screen.getByTestId('sidebar-stub'));
    expect(sidebar.getByRole('button', { name: '网站改版' })).toBeInTheDocument();
  });

  it('loads archived task rooms without sync metadata and opens their history through a deep link', () => {
    loaded();
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!archive:test'], state: 'joined', refetch: vi.fn() });
    hooksMock.useArchivedRooms.mockReturnValue({ data: { rooms: [{ room_id: '!archive:test', name: '已验收任务', room_meta: { teamName: 'design' }, joined_member_count: 3 }] }, isSuccess: true });
    useHitlInboxStore.getState().setPendingChatRoomId('!archive:test');
    renderWithQueryClient();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!archive:test');
    expect(screen.queryByRole('button', { name: '已归档房间' })).toBeNull();
    expect(screen.queryByRole('button', { name: '归档任务' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换团队及任务房间' }));
    expect(within(screen.getByTestId('sidebar-stub')).queryByRole('button', { name: '已验收任务' })).toBeNull();
  });

  it('restores the same account selection and gives an explicit deep link priority', () => {
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', admin: { name: 'alice' }, leaderDMRoomID: '!leader:test' }], isLoading: false });
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
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', admin: { name: 'alice' }, leaderDMRoomID: '!leader:test' }], isLoading: false });
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
    hooksMock.useTeams.mockReturnValue({ data: [{ name: 'design', admin: { name: 'alice' }, leaderDMRoomID: '!leader:test' }], isLoading: false });
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

  it('switches between owned team assistants and never lists team group chats as assistants', async () => {
    renderWithQueryClient('assistants');
    fireEvent.click(screen.getByRole('button', { name: '切换助手' }));
    const choices = within(screen.getByRole('region', { name: '团队助手' }));
    expect(choices.getByRole('button', { name: 'Team A助手' })).toBeInTheDocument();
    expect(choices.getByRole('button', { name: 'Team B助手' })).toBeInTheDocument();
    expect(choices.queryByRole('button', { name: /Team C|Team D/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-stub')).not.toBeInTheDocument();
    fireEvent.click(choices.getByRole('button', { name: 'Team B助手' }));
    await waitFor(() => expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!dm-b:test'));
  });

  it('does not turn platform administration or stale DM membership into Team Admin rights', () => {
    sessionMock.userLevel = 3;
    sessionMock.sessionUser = 'operator';
    hooksMock.useManagers.mockReturnValue({ data: [{ name: 'default', roomID: '!ops:test' }], isLoading: false });
    hooksMock.useRoomAccess.mockReturnValue({ joinedRooms: ['!ops:test', '!dm-a:test', '!group-a:test'], state: 'joined', refetch: vi.fn() });
    useHitlInboxStore.getState().setPendingChatRoomId('!dm-a:test');
    renderWithQueryClient('assistants');
    expect(screen.getByText(/团队助手私聊仅对该团队的 Team Admin 开放/)).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!ops:test');
    fireEvent.click(screen.getByRole('button', { name: '切换助手' }));
    expect(screen.queryByRole('button', { name: 'Team A助手' })).not.toBeInTheDocument();
    expect(screen.getByText('团队助手仅对你担任 Team Admin 的团队开放。')).toBeInTheDocument();
  });

  it('keeps ordinary members in their joined team groups without exposing team assistant DMs', () => {
    sessionMock.sessionUser = 'member';
    renderWithQueryClient('assistants');
    expect(screen.queryByTestId('chat-panel-stub')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '切换助手' }));
    expect(screen.queryByRole('button', { name: /Team [A-D]助手/ })).not.toBeInTheDocument();
    expect(screen.getByText('团队助手仅对你担任 Team Admin 的团队开放。')).toBeInTheDocument();
  });

  it('keeps the accessible leader conversation and team link without an assistant space list', () => {
    renderWithQueryClient('assistants');
    expect(screen.queryByRole('button', { name: '切换团队及任务房间' })).toBeNull();
    expect(screen.queryByTestId('sidebar-stub')).toBeNull();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!dm-a:test');
    fireEvent.click(screen.getByRole('button', { name: '团队协作' }));
    expect(useSectionStore.getState().activeSection).toBe('my-teams');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!group-a:test');
  });

  it('shows every joined team, identifies each role, and opens ordinary member groups', async () => {
    renderWithQueryClient('teams');
    fireEvent.click(screen.getByRole('button', { name: '切换团队' }));
    const sidebar = within(screen.getByRole('list', { name: '我的团队' }));
    expect(sidebar.getAllByRole('button', { name: /Team [A-D]/ })).toHaveLength(4);
    expect(screen.getByRole('button', { name: '切换团队' })).toHaveTextContent('Team A管理员');
    fireEvent.click(sidebar.getByRole('button', { name: /Team C/ }));
    await waitFor(() => expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!group-c:test'));
    expect(screen.getByRole('button', { name: '切换团队' })).toHaveTextContent('Team C成员');
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
  it('keeps execution rooms out of the team picker', () => {
    taskBoardMock.tasks = [
      { runId: 'standalone', title: '真实任务房间', status: 'in_progress', teamId: 'design', executionRoomId: '!project:test', roomId: '!leader:test', assignedTo: 'leader', dependsOn: [], createdAt: 0, source: 'controller', outcome: null },
      { runId: 'private', title: '未加入的任务', status: 'pending', executionRoomId: '!private:test', roomId: '!leader:test', assignedTo: 'leader', dependsOn: [], createdAt: 0, source: 'controller', outcome: null },
    ];
    taskFeedMock.workflows = [];
    renderWithQueryClient('teams');
    fireEvent.click(screen.getByRole('button', { name: '切换团队' }));
    const sidebar = within(screen.getByRole('list', { name: '我的团队' }));
    expect(sidebar.queryByRole('button', { name: /真实任务房间/ })).toBeNull();
    expect(sidebar.queryByRole('button', { name: '未加入的任务' })).toBeNull();
  });
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

  it('selects teams directly and keeps project rooms out of the picker', () => {
    renderWithQueryClient('teams');
    fireEvent.click(screen.getByRole('button', { name: '切换团队' }));
    const sidebar = within(screen.getByRole('list', { name: '我的团队' }));
    expect(sidebar.queryByRole('button', { name: /网站改版/ })).toBeNull();
    const team = sidebar.getByRole('button', { name: /设计团队/ });
    expect(team).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开团队/ })).toBeNull();
    expect(screen.queryByPlaceholderText('搜索对话…')).toBeNull();
    fireEvent.click(team);
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!group:test');
  });

  it('restores a team instead of an old remembered task room', () => {
    localStorage.setItem(`${conversationStorageKey('https://test', '@user:test')}:teams`, '!project:test');
    renderWithQueryClient('teams');
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!group:test');
    expect(useSectionStore.getState().taskCollaboration).toBeNull();
  });

  it('does not list project rooms in the assistants view', () => {
    renderWithQueryClient('assistants');
    expect(screen.queryByTestId('sidebar-stub')).toBeNull();
    expect(screen.queryByText(/网站改版/)).toBeNull();
  });

  it('routes a project deep link from the assistants view into my teams', () => {
    useHitlInboxStore.getState().setPendingChatRoomId('!project:test');
    renderWithQueryClient('assistants');
    expect(useSectionStore.getState().activeSection).toBe('my-teams');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!project:test');
  });

  it('opens an execution room under task board navigation even when its origin is the assistant DM', () => {
    taskFeedMock.workflows = [{ ...projectWorkflow, source_room_id: '!leader:test', tasks_detail: [{ task_id: 'task', room_id: '!project:test' }] }];
    useHitlInboxStore.getState().setPendingChatRoomId('!project:test');
    renderWithQueryClient('assistants');
    expect(useSectionStore.getState().activeSection).toBe('chat');
    expect(useSectionStore.getState().taskCollaboration).toEqual({ taskId: 'task', roomId: '!project:test' });
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(screen.getByTestId('chat-panel-stub')).toHaveTextContent('!project:test');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
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

  it('opens a touch accessible room picker and closes it with Escape', async () => {
    renderWithQueryClient();
    expect(screen.queryByTestId('sidebar-stub')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '切换团队及任务房间' }));
    expect(screen.getByTestId('sidebar-stub')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '切换团队及任务房间' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('sidebar-stub')).toBeNull());
    expect(screen.getByRole('button', { name: '切换团队及任务房间' })).toHaveFocus();
  });
});

describe('ChatSection merged section chrome', () => {
  beforeEach(() => {
    loaded();
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps connection diagnostics out of normal conversation chrome', () => {
    renderWithQueryClient();

    expect(screen.queryByText('Agent Chat')).toBeNull();
    expect(screen.queryByText('实时通信与人机协同')).toBeNull();

    expect(screen.queryByTestId('sidebar-stub')).toBeNull();
    expect(screen.queryByText('SyncChip')).toBeNull();
    expect(screen.queryByText('对话已连接')).toBeNull();
    expect(screen.queryByRole('button', { name: '断开对话连接' })).toBeNull();
    expect(screen.queryByRole('button', { name: /服务端能力/ })).toBeNull();
  });

  it('still opens and completes reconnection from the disconnected notice', async () => {
    sessionMock.isLoggedIn = false;
    renderWithQueryClient();
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    expect(screen.getByRole('dialog', { name: '重新连接对话' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成连接' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '重新连接对话' })).toBeNull());
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
    fireEvent.click(screen.getByRole('button', { name: '切换团队及任务房间' }));
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
