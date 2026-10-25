import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomTasksPanel } from './RoomTasksPanel';
import { useTaskStore } from '@/lib/task-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';

const getProjectWorkflow = vi.fn();

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
  beforeEach(() => {
    useTaskStore.getState().clearTasks();
    useHitlInboxStore.setState({ pendingProjectKey: null });
    useSectionStore.setState({ activeSection: 'chat' });
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
  });

  it('只展示当前房间的工作流任务，并用项目正源覆盖状态', async () => {
    seedTask();
    seedTask({ runId: 'proj-2', title: '别的空间任务', roomId: '!other:test' });

    renderPanel();

    expect(screen.queryByText('别的空间任务')).toBeNull();
    expect(await screen.findByText('产品介绍页生产线（正源）')).toBeInTheDocument();
    expect(screen.getByText('1/2 完成')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(getProjectWorkflow).toHaveBeenCalledWith('proj-1', { includeTasks: true });
  });

  it('「任务中心」把项目 id 与 team 写入真实深链通道', async () => {
    seedTask();
    renderPanel();
    // 等正源 overlay 落地后再点，deep-link 才能带上 Controller 的 team_id。
    await screen.findByText('live');

    fireEvent.click(screen.getByRole('button', { name: /任务中心/ }));

    await waitFor(() => {
      expect(useHitlInboxStore.getState().pendingProjectKey).toEqual({ id: 'proj-1', team: 'team-1' });
    });
    expect(useSectionStore.getState().activeSection).toBe('tasks');
  });

  it('没有工作流消息时给出真实来源的空态，不填充假任务', () => {
    renderPanel('!empty:test');

    expect(screen.getByText('本空间还没有任务消息')).toBeInTheDocument();
    expect(screen.queryByText('产品介绍页生产线')).toBeNull();
    expect(getProjectWorkflow).not.toHaveBeenCalled();
  });
});
