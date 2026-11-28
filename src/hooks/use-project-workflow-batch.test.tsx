import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ProjectSummary, WorkflowResponse } from '@/lib/agentteams-projects-api';
import type { IndexedTask } from '@/hooks/use-projects';
import { ShellPollingProvider } from '@/lib/shell-polling';
import {
  projectWorkflowQueryKey,
  selectFastLaneProjects,
  useProjectWorkflowBatch,
  workflowFromTaskIndex,
} from './use-project-workflow-batch';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getProjectWorkflow: vi.fn(),
  taskIndexRequest: vi.fn(),
}));

vi.mock('@/lib/agentteams-projects-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agentteams-projects-api')>();
  return {
    ...actual,
    listProjects: mocks.listProjects,
    getProjectWorkflow: mocks.getProjectWorkflow,
  };
});

vi.mock('@/hooks/use-projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-projects')>();
  const { useQuery } = await import('@tanstack/react-query');
  return {
    ...actual,
    useTaskIndex: ({ enabled = true, refetchInterval = 5000 }: {
      enabled?: boolean;
      refetchInterval?: number | false;
    } = {}) => useQuery({
      queryKey: ['agentteams-task-index'],
      queryFn: mocks.taskIndexRequest,
      enabled,
      refetchInterval,
      retry: false,
    }),
  };
});

function project(index: number): ProjectSummary {
  return {
    project_id: `project-${index}`,
    title: `Project ${index}`,
    status: 'active',
    team_id: 'team-1',
  };
}

function task(index: number, overrides: Partial<IndexedTask> = {}): IndexedTask {
  return {
    task_id: `task-${index}`,
    project_id: `project-${index}`,
    team_id: 'team-1',
    title: `Task ${index}`,
    status: 'in-progress',
    ...overrides,
  };
}

function workflow(item: ProjectSummary): WorkflowResponse {
  return {
    project_id: item.project_id,
    title: item.title,
    status: item.status,
    team_id: item.team_id,
    nodes: [],
    edges: [],
    next: [],
    interrupts: [],
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useProjectWorkflowBatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listProjects.mockReset().mockResolvedValue({
      projects: Array.from({ length: 20 }, (_, index) => project(index)),
      total: 20,
    });
    mocks.taskIndexRequest.mockReset().mockResolvedValue({
      tasks: Array.from({ length: 20 }, (_, index) => task(index)),
    });
    mocks.getProjectWorkflow.mockReset().mockImplementation(async (projectId: string) => {
      const index = Number(projectId.split('-')[1]);
      return workflow(project(index));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps 20 idle projects within the request budget without detail polling', async () => {
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useProjectWorkflowBatch({ activeRoomId: null }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(mocks.listProjects.mock.calls.length).toBeLessThanOrEqual(3);
    expect(mocks.taskIndexRequest.mock.calls.length).toBeLessThanOrEqual(13);
    expect(mocks.listProjects.mock.calls.length + mocks.taskIndexRequest.mock.calls.length).toBeLessThanOrEqual(30);
    expect(mocks.getProjectWorkflow).not.toHaveBeenCalled();
    unmount();
  });

  it('pauses project and aggregate polling while the shell is hidden', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ShellPollingProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ShellPollingProvider>
    );
    const { unmount } = renderHook(() => useProjectWorkflowBatch({ activeRoomId: null }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.listProjects).toHaveBeenCalledTimes(1);
    expect(mocks.taskIndexRequest).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('refreshes only the current project workflow every five seconds', async () => {
    mocks.taskIndexRequest.mockResolvedValue({
      tasks: [task(0, { room_id: 'room:!current:test' }), ...Array.from({ length: 19 }, (_, index) => task(index + 1))],
    });
    const { wrapper } = createWrapper();
    const { result, unmount } = renderHook(() => useProjectWorkflowBatch({
      activeRoomId: '!current:test',
    }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.fastLaneProjectIds).toEqual(['project-0']);
    expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(2);
    expect(mocks.getProjectWorkflow.mock.calls.every(([id]) => id === 'project-0')).toBe(true);
    unmount();
  });

  it('bounds project workflow detail requests to four in flight', async () => {
    mocks.taskIndexRequest.mockResolvedValue({
      tasks: Array.from({ length: 5 }, (_, index) => task(index, { room_id: '!current:test' })),
    });
    const resolvers: Array<(_value: WorkflowResponse) => void> = [];
    let active = 0;
    let maxActive = 0;
    mocks.getProjectWorkflow.mockImplementation((_projectId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<WorkflowResponse>((resolve) => {
        resolvers.push((value) => {
          active -= 1;
          resolve(value);
        });
      });
    });
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useProjectWorkflowBatch({ activeRoomId: '!current:test' }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(maxActive).toBe(4);
    expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(4);

    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve(workflow(project(0)));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.getProjectWorkflow).toHaveBeenCalledTimes(5);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve(workflow(project(0)));
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
  });

  it('selects the direct project room but avoids a busy operations assistant fan-out', () => {
    const projects = [project(0), project(1)];
    const direct = [task(0, { room_id: 'room:!current:test' })];
    expect(selectFastLaneProjects(projects, direct, '!current:test').map(item => item.project_id)).toEqual(['project-0']);

    const sourced = [
      task(0, { source_room_id: '!operations:test' }),
      task(1, { source_room_id: '!operations:test' }),
    ];
    expect(selectFastLaneProjects(projects, sourced, '!operations:test')).toEqual([]);
  });

  it('projects aggregate task data into the compatible workflow shape', () => {
    const item = project(0);
    const tasks = [
      task(0, { status: 'running', depends_on: [], assigned_to: '@worker:test' }),
      task(1, { project_id: item.project_id, status: 'completed', depends_on: ['task-0'] }),
    ];
    const result = workflowFromTaskIndex(item, tasks);
    expect(result?.nodes.map(node => [node.id, node.status])).toEqual([
      ['task-0', 'in-progress'],
      ['task-1', 'completed'],
    ]);
    expect(result?.edges).toEqual([{ source: 'task-0', target: 'task-1' }]);
    expect(result?.next).toEqual(['task-1']);
    expect(result?.tasks_detail).toHaveLength(2);
  });

  it('writes successful detail results into the existing per-project cache key', async () => {
    mocks.taskIndexRequest.mockResolvedValue({ tasks: [task(0, { room_id: '!current:test' })] });
    const { queryClient, wrapper } = createWrapper();
    const { unmount } = renderHook(() => useProjectWorkflowBatch({ activeRoomId: '!current:test' }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(queryClient.getQueryData(projectWorkflowQueryKey(project(0)))).toMatchObject({
      project_id: 'project-0',
    });
    unmount();
  });
});
