import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomTasksPanel } from './RoomTasksPanel';
import { useTaskStore } from '@/lib/task-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';

const getProjectWorkflow = vi.fn();
const board = vi.hoisted(() => ({ tasks: [] as import('@/hooks/use-task-board').BoardTask[] }));
vi.mock('@/hooks/use-projects', () => ({ useApiTaskBoard: () => ({ tasks: board.tasks }) }));
vi.mock('@/hooks/use-chat-room-access', () => ({
  useChatRoomAccess: () => ({ state: 'joined', joinedRooms: ['!execution:test'] }),
}));

vi.mock('@/lib/agentteams-projects-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agentteams-projects-api')>();
  return { ...actual, getProjectWorkflow: (...args: unknown[]) => getProjectWorkflow(...args) };
});

function renderPanel(roomId = '!room:test') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <RoomTasksPanel roomId={roomId} />
    </QueryClientProvider>,
  );
}

function seedTask(overrides: Partial<Parameters<ReturnType<typeof useTaskStore.getState>['upsertTask']>[0]> = {}) {
  useTaskStore.getState().upsertTask({
    runId: 'proj-1',
    title: '产品介绍页生产线',
    status: 'running',
    roomId: '!room:test',
    senderMatrixUserId: '@manager:test',
    subagents: [],
    steps: [
      { id: 'info', name: '信息架构', status: 'completed' },
      { id: 'design', name: '页面设计', status: 'in_progress', assignedTo: 'designer' },
    ],
    ...overrides,
  });
}

describe('RoomTasksPanel（房间任务 tab · 底座接线）', () => {
  it('shows the current execution room task family even without workflow messages', () => {
    const base = { assignedTo: 'leader', dependsOn: [], roomId: '!source:test', createdAt: 1, outcome: null, source: 'controller', teamId: 'team' } as const;
    board.tasks = [
      { ...base, dependsOn: [], runId: 'main', title: '主任务', status: 'in_progress' },
      { ...base, dependsOn: [], runId: 'child', title: '实现', status: 'completed', parentTaskId: 'main', executionRoomId: '!room:test' },
      { ...base, dependsOn: ['child'], runId: 'check', title: '验证', status: 'in_progress', parentTaskId: 'main' },
      { ...base, dependsOn: [], runId: 'other', title: '其他任务', status: 'assigned', executionRoomId: '!other:test' },
    ];
    renderPanel();
    expect(screen.queryByRole('group', { name: '项目任务分工与依赖' })).toBeNull();
    expect(screen.getByText('子任务 1/2 已完成')).toBeInTheDocument();
    expect(screen.queryByText('其他任务')).toBeNull();
    const trigger = screen.getByRole('button', { name: '查看详情' });
    fireEvent.click(trigger);
    const detail = within(screen.getByRole('dialog', { name: '主任务' }));
    const topology = within(detail.getByRole('group', { name: '项目任务分工与依赖' }));
    fireEvent.click(topology.getByRole('button', { name: '验证 · leader' }));
    expect(detail.getByText('所选任务：验证')).toBeInTheDocument();
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });
  it('adds newly polled tasks ahead of completed tasks without replacing the conversation', () => {
    const base = { assignedTo: 'leader', dependsOn: [], roomId: '!room:test', createdAt: 1, outcome: null, source: 'controller', teamId: 'team' } as const;
    board.tasks = [{ ...base, dependsOn: [], runId: 'old', title: '已完成的旧任务', status: 'completed', completedAt: 61001 }];
    const view = renderPanel();
    board.tasks = [...board.tasks,
      { ...base, dependsOn: [], runId: 'new', title: '当前会话的新任务', status: 'pending', createdAt: 2 },
      { ...base, dependsOn: [], runId: 'other', title: '其他会话的新任务', status: 'in_progress', roomId: '!other:test' },
    ];
    view.rerender(<QueryClientProvider client={new QueryClient()}><RoomTasksPanel roomId="!room:test" /></QueryClientProvider>);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('当前会话的新任务');
    expect(cards[1]).toHaveTextContent('已完成的旧任务');
    expect(screen.queryByText('其他会话的新任务')).toBeNull();
  });
  it('opens the task execution room and disables collaboration before dispatch', () => {
    const base = { assignedTo: 'leader', dependsOn: [], roomId: '!room:test', createdAt: 1, outcome: null, source: 'controller' } as const;
    board.tasks = [
      { ...base, dependsOn: [], runId: 'travel', teamId: 'travel-crew', title: '旅行规划', status: 'in_progress' },
      { ...base, dependsOn: [], runId: 'itinerary', teamId: 'travel-crew', title: '行程', parentTaskId: 'travel', status: 'assigned', executionRoomId: 'room:!execution:test' },
      { ...base, dependsOn: [], runId: 'pending', teamId: 'travel-crew', title: '未派发任务', status: 'pending' },
    ];
    renderPanel();
    const card = within(screen.getByRole('article', { name: '旅行规划' }));
    fireEvent.click(card.getByRole('button', { name: '进入协作房间' }));
    expect(useSectionStore.getState().taskCollaboration).toEqual({ taskId: 'travel', roomId: '!execution:test' });
    const pending = within(screen.getByRole('article', { name: '未派发任务' }));
    expect(pending.getByRole('button', { name: '进入协作房间' })).toBeDisabled();
  });
  it('reads total elapsed time from historical completion metadata', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      created_at: '2026-11-19T08:29:48Z',
      completed_at: '2026-11-19T08:38:26Z',
    })));
    vi.stubGlobal('fetch', fetch);
    board.tasks = [{
      runId: 'travel', title: '已完成的旅行规划', teamId: 'travel-crew', kind: 'main', roomId: '!room:test',
      status: 'completed', dependsOn: [], createdAt: 0, assignedTo: 'leader', outcome: null, source: 'api',
    }];
    renderPanel();
    expect(await screen.findByText('总耗时 8 分 38 秒')).toBeInTheDocument();
    const url = new URL(fetch.mock.calls[0][0], window.location.href);
    expect(url.pathname.replace(/\/$/, '')).toBe('/api/agentteams/tasks/travel/meta');
    expect(url.searchParams.get('team')).toBe('travel-crew');
  });
  beforeEach(() => {
    board.tasks = [];
    useTaskStore.getState().clearTasks();
    useHitlInboxStore.setState({ pendingProjectKey: null, pendingChatRoomId: null });
    useSectionStore.setState({ activeSection: 'chat', taskCollaboration: null });
    getProjectWorkflow.mockResolvedValue({
      project_id: 'proj-1',
      title: '产品介绍页生产线（正源）',
      status: 'running',
      team_id: 'team-1',
      nodes: [
        { id: 'info', name: '信息架构', status: 'completed' },
        { id: 'design', name: '页面设计', status: 'in_progress', assignee: 'designer' },
      ],
      edges: [],
      next: [],
      interrupts: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('只展示当前房间的工作流任务，并用项目正源覆盖状态', async () => {
    seedTask();
    seedTask({ runId: 'proj-2', title: '别的空间任务', roomId: '!other:test' });

    renderPanel();

    expect(screen.queryByText('别的空间任务')).toBeNull();
    expect(await screen.findByText('产品介绍页生产线（正源）')).toBeInTheDocument();
    expect(screen.getByText('1/2 完成')).toBeInTheDocument();
    expect(screen.getByText('已同步')).toBeInTheDocument();
    expect(getProjectWorkflow).toHaveBeenCalledWith('proj-1', { includeTasks: true });
  });

  it('「任务中心」把项目 id 与 team 写入真实深链通道', async () => {
    seedTask();
    renderPanel();
    // 等正源 overlay 落地后再点，deep-link 才能带上 Controller 的 team_id。
    await screen.findByText('已同步');

    fireEvent.click(screen.getByRole('button', { name: '查看项目详情' }));

    await waitFor(() => {
      expect(useHitlInboxStore.getState().pendingProjectKey).toEqual({ id: 'proj-1', team: 'team-1' });
    });
    expect(useSectionStore.getState().activeSection).toBe('tasks');
  });

  it('没有工作流消息时给出真实来源的空态，不填充假任务', () => {
    renderPanel('!empty:test');

    expect(screen.getByText('本空间还没有关联任务')).toBeInTheDocument();
    expect(screen.queryByText('产品介绍页生产线')).toBeNull();
    expect(getProjectWorkflow).not.toHaveBeenCalled();
  });
});
