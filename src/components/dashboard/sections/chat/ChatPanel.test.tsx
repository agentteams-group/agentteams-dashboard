import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import type { RoomInfo } from './room-info';
import { useAgentTeamsStore } from '@/lib/agentteams-store';

const api = vi.hoisted(() => ({ listProjects: vi.fn(), getProjectWorkflow: vi.fn() }));
vi.mock('@/lib/agentteams-projects-api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/agentteams-projects-api')>(), listProjects: api.listProjects, getProjectWorkflow: api.getProjectWorkflow }));
vi.mock('./ChatRoom', () => ({
  ChatRoom: ({ roomName, topic, integratedSidebar, headerActions }: {
    roomName: string;
    topic?: string;
    integratedSidebar?: boolean;
    headerActions?: ReactNode;
  }) => <div data-integrated-sidebar={String(integratedSidebar)}>
    {roomName}{topic && <p>{topic}</p>}{headerActions}
  </div>,
}));
vi.mock('./components/ConversationTaskTips', () => ({ ConversationTaskTips: () => <button type="button">当前对话的任务</button> }));
vi.mock('./manager-model-gate', () => ({ ManagerModelGate: ({ children }: { children: (_configured: boolean) => ReactNode }) => children(true) }));

const teamRoom: RoomInfo = { id: '!team:test', name: '设计群聊', type: 'team', members: [], parentTeam: 'design', team: { name: 'design', teamName: '设计团队' } as RoomInfo['team'] };

function renderChat(room: RoomInfo, managerName?: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <ChatPanel room={room} contextPanel={null} onContextPanelChange={vi.fn()} managerName={managerName} />
  </QueryClientProvider>);
}

beforeEach(() => {
  useAgentTeamsStore.setState({ userLevel: 3 });
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  useHitlInboxStore.setState({ confirmations: {}, pendingChatRoomId: null });
  api.listProjects.mockResolvedValue({ projects: [{ project_id: 'project', title: '网站改版', team_id: 'design', status: 'active' }, { project_id: 'other-project', team_id: 'other', status: 'active' }], total: 2 });
  api.getProjectWorkflow.mockResolvedValue({ project_id: 'project', title: '网站改版', status: 'active', team_id: 'design', nodes: [{ id: 'task', name: '首页设计', status: 'in-progress' }], tasks_detail: [{ task_id: 'task', status: 'submitted' }], edges: [], next: [], interrupts: [] });
});
afterEach(cleanup);

describe('chat header actions', () => {
  it('shows the Worker resource ID below a distinct private chat title', () => {
    renderChat({ id: '!worker:test', name: '月见·研究助手', type: 'worker', members: [], workerName: 'worker-a', parentTeam: 'design' });
    expect(screen.getByText('月见·研究助手')).toBeInTheDocument();
    expect(screen.getByText('ID worker-a · 团队: design')).toBeInTheDocument();
  });

  it.each(['worker-a', 'worker-a 房间'])('shows the Worker resource ID alongside the chat title %s', (name) => {
    renderChat({ id: '!worker:test', name, type: 'worker', members: [], workerName: 'worker-a' });
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText('ID worker-a')).toBeInTheDocument();
  });

  it('opens settings for the selected platform assistant and preserves its instance name', () => {
    renderChat({ id: '!ops:test', name: '平台助手 · second', type: 'manager', agentRole: 'operations', members: [] }, 'second');
    expect(screen.getByText('平台助手 · second')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '当前对话的任务' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '平台助手设置' }));
    expect(window.location.hash).toBe('#workbench/assistant/settings?manager=second');
  });
  it('hides platform settings from Team accounts and Leader conversations', () => {
    useAgentTeamsStore.setState({ userLevel: 2 });
    const view = renderChat({ id: '!ops:test', name: '平台助手', type: 'manager', agentRole: 'operations', members: [] }, 'default');
    expect(screen.queryByRole('button', { name: '平台助手设置' })).toBeNull();
    view.unmount();
    useAgentTeamsStore.setState({ userLevel: 3 });
    renderChat({ id: '!leader:test', name: '团队助手', type: 'manager', agentRole: 'leader', members: [] }, 'lead');
    expect(screen.queryByRole('button', { name: '平台助手设置' })).toBeNull();
  });
  it('omits the pending action in a Team group while preserving team chat', () => {
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId: teamRoom.id, eventId: '$approval', sender: '@leader:test', toolName: '发布', question: '现在发布吗？', timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    renderChat(teamRoom);
    expect(screen.getByText('设计群聊').closest('[data-integrated-sidebar]')).toHaveAttribute('data-integrated-sidebar', 'true');
    expect(screen.queryByRole('button', { name: /待我处理/ })).toBeNull();
    expect(useHitlInboxStore.getState().confirmations.approval).toBeDefined();
  });

  it('keeps the pending action out of the Leader header when the context panel changes', () => {
    const room: RoomInfo = { ...teamRoom, id: '!leader:test', type: 'manager', agentRole: 'leader', name: '团队助手' };
    const client = new QueryClient();
    const header = (contextPanel: 'tasks' | null) => <QueryClientProvider client={client}>
      <ChatPanel room={room} contextPanel={contextPanel} onContextPanelChange={vi.fn()} />
    </QueryClientProvider>;
    const view = render(header(null));
    view.rerender(header('tasks'));
    view.rerender(header(null));
    expect(screen.queryByRole('button', { name: /^待我处理/ })).toBeNull();
  });

  it('does not add a task note to an ordinary Worker DM', () => {
    renderChat({ id: '!worker:test', name: 'Worker 私聊', type: 'worker', members: [], parentTeam: 'design' });
    expect(screen.queryByRole('complementary', { name: '任务便签' })).toBeNull();
    expect(screen.getByText('Worker 私聊')).toHaveAttribute('data-integrated-sidebar', 'false');
    expect(api.listProjects).not.toHaveBeenCalled();
  });
});
