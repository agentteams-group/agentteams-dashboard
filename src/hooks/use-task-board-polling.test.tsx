import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useApiTaskBoard, useTaskIndex } from './use-projects';
import { useAssistantTaskFeed } from './use-assistant-task-feed';
import { conversationTaskNotes } from '@/lib/assistant-task-notes';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';
import { getProjectWorkflow, listProjects } from '@/lib/agentteams-projects-api';
import { requestJson } from '@/lib/api-base';

vi.mock('@/lib/api-base', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api-base')>(),
  requestJson: vi.fn(),
}));

vi.mock('@/lib/agentteams-projects-api', () => ({
  listProjects: vi.fn(),
  getProjectWorkflow: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(requestJson).mockResolvedValue({ tasks: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('refreshes task states while the unchanged project list stays mounted', async () => {
  vi.useFakeTimers();
  vi.mocked(listProjects).mockResolvedValue({ projects: [{ project_id: 'p1', title: 'Project', status: 'active' }], total: 1 });
  const workflow = { project_id: 'p1', title: 'Project', status: 'active' as const, edges: [], next: [], interrupts: [] };
  vi.mocked(getProjectWorkflow)
    .mockResolvedValueOnce({ ...workflow, nodes: [{ id: 'task1', name: 'Task', status: 'delegated' }] })
    .mockResolvedValue({ ...workflow, nodes: [{ id: 'task1', name: 'Task', status: 'in-progress' }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => useApiTaskBoard(), { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(result.current.tasks[0]?.status).toBe('assigned');
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(result.current.tasks[0]?.status).toBe('in_progress');
  const calls = vi.mocked(getProjectWorkflow).mock.calls.length;
  unmount();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(getProjectWorkflow).toHaveBeenCalledTimes(calls);
  client.clear();
});

it('refreshes standalone main task states every five seconds', async () => {
  vi.useFakeTimers();
  vi.mocked(listProjects).mockResolvedValue({ projects: [], total: 0 });
  const task = { task_id: 'main1', main_task_id: 'main1', title: 'Main task' };
  vi.mocked(requestJson)
    .mockResolvedValueOnce({ tasks: [{ ...task, status: 'delegated' }] })
    .mockResolvedValue({ tasks: [{ ...task, status: 'in-progress' }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useApiTaskBoard(), { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(result.current.tasks[0]?.status).toBe('assigned');
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(result.current.tasks[0]?.status).toBe('in_progress');
  client.clear();
});

it('discovers new conversation tasks, refreshes their status and hides completed tasks without a manual refresh', async () => {
  vi.useFakeTimers();
  const room: RoomInfo = { id: '!assistant:test', name: 'Assistant', type: 'manager', agentRole: 'operations', members: [], access: 'joined' };
  const project = { project_id: 'p1', title: 'Project', status: 'active' as const };
  vi.mocked(listProjects).mockResolvedValueOnce({ projects: [], total: 0 }).mockResolvedValue({ projects: [project], total: 1 });
  vi.mocked(requestJson).mockResolvedValue({ tasks: [
    { task_id: 'task1', project_id: project.project_id, source_room_id: room.id, room_id: `room:${room.id}`, title: 'Task' },
  ] });
  const workflow = { ...project, source_room_id: room.id, edges: [], next: [], interrupts: [] };
  vi.mocked(getProjectWorkflow).mockResolvedValue({ ...workflow, nodes: [{ id: 'task1', name: 'Task', status: 'delegated' }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => {
    const feed = useAssistantTaskFeed(room);
    return { feed, items: conversationTaskNotes(room, feed.workflows).filter(item => item.group !== 'completed') };
  }, { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(result.current.items).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_050); });
  expect(result.current.items[0]?.status).toBe('delegated');
  vi.mocked(getProjectWorkflow).mockResolvedValue({ ...workflow, nodes: [{ id: 'task1', name: 'Task', status: 'in-progress' }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(5_050); });
  expect(result.current.items[0]?.status).toBe('in-progress');
  vi.mocked(getProjectWorkflow).mockResolvedValue({ ...workflow, status: 'completed', nodes: [{ id: 'task1', name: 'Task', status: 'completed' }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(5_050); });
  expect(result.current.items).toHaveLength(0);
  // A completed project can be resumed or gain a follow-up task.
  vi.mocked(getProjectWorkflow).mockResolvedValue({ ...workflow, nodes: [{ id: 'task2', name: 'Follow-up', status: 'pending' }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(5_050); });
  expect(result.current.items[0]?.title).toBe('Follow-up');
  client.clear();
});


it('loads 21 projects in explicit batches and requests workflows only for visible projects', async () => {
  const projects = Array.from({ length: 21 }, (_, index) => ({
    project_id: `p${index + 1}`,
    title: `Project ${index + 1}`,
    status: 'active' as const,
  }));
  vi.mocked(listProjects).mockResolvedValue({ projects, total: projects.length });
  vi.mocked(getProjectWorkflow).mockImplementation(async (projectId) => ({
    project_id: projectId, title: projectId, status: 'active', nodes: [], edges: [], next: [], interrupts: [],
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useApiTaskBoard(), { wrapper });
  await waitFor(() => expect(result.current.projects).toHaveLength(20));
  expect(result.current.projectTotal).toBe(21);
  expect(result.current.hasMoreProjects).toBe(true);
  expect(getProjectWorkflow).toHaveBeenCalledTimes(20);
  expect(getProjectWorkflow).not.toHaveBeenCalledWith('p21', expect.anything());

  act(() => result.current.loadMoreProjects());
  await waitFor(() => expect(result.current.projects).toHaveLength(21));
  await waitFor(() => expect(getProjectWorkflow).toHaveBeenCalledWith('p21', expect.anything()));
  expect(getProjectWorkflow).toHaveBeenCalledTimes(21);
  expect(result.current.hasMoreProjects).toBe(false);
  client.clear();
});

it('reports a truncated project list when total exceeds returned projects', async () => {
  const projects = Array.from({ length: 20 }, (_, index) => ({
    project_id: `p${index + 1}`, title: `Project ${index + 1}`, status: 'active' as const,
  }));
  vi.mocked(listProjects).mockResolvedValue({ projects, total: 21 });
  vi.mocked(getProjectWorkflow).mockResolvedValue({ project_id: 'p1', title: 'P', status: 'active', nodes: [], edges: [], next: [], interrupts: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useApiTaskBoard(), { wrapper });
  await waitFor(() => expect(result.current.projects).toHaveLength(20));
  expect(result.current.projectTotal).toBe(21);
  expect(result.current.hasMoreProjects).toBe(false);
  client.clear();
});

it('discovers a standalone main task from this conversation without a project', async () => {
  vi.useFakeTimers();
  const room: RoomInfo = { id: '!assistant:test', name: 'Assistant', type: 'manager', agentRole: 'operations', members: [], access: 'joined' };
  const main = { task_id: 'main', main_task_id: 'main', team_id: 'travel', title: 'Standalone task', source_room_id: `room:${room.id}`, room_id: 'room:!execution:test', status: 'assigned' };
  vi.mocked(requestJson).mockResolvedValue({ tasks: [
    main,
    { ...main, task_id: 'child', parent_task_id: 'main', title: 'Child task' },
    { ...main, task_id: 'other', main_task_id: 'other', source_room_id: '!other:test' },
  ] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => {
    const index = useTaskIndex();
    return conversationTaskNotes(room, [], index.data?.tasks).filter(item => item.group !== 'completed');
  }, { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(result.current).toHaveLength(1);
  expect(result.current[0]).toMatchObject({ title: 'Standalone task', roomId: '!execution:test', status: 'assigned', group: 'running' });
  vi.mocked(requestJson).mockResolvedValue({ tasks: [{ ...main, status: 'completed' }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(5_050); });
  expect(result.current).toHaveLength(0);
  client.clear();
});
