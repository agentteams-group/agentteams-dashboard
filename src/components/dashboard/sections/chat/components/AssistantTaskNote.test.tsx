import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantTaskNote } from './AssistantTaskNote';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import type { WorkflowResponse } from '@/lib/agentteams-projects-api';
import type { RoomInfo } from '../room-info';

const api = vi.hoisted(() => ({ listProjects: vi.fn(), getProjectWorkflow: vi.fn(), notify: vi.fn() }));
vi.mock('@/lib/agentteams-projects-api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/agentteams-projects-api')>(), listProjects: api.listProjects, getProjectWorkflow: api.getProjectWorkflow }));
vi.mock('sonner', () => ({ toast: { info: api.notify } }));

const room: RoomInfo = { id: '!leader:test', name: '设计团队助手', type: 'manager', agentRole: 'leader', members: [], parentTeam: 'design', team: { name: 'design', teamName: '设计团队' } as RoomInfo['team'] };
const wf: WorkflowResponse = { project_id: 'project', title: '网站改版', status: 'active', team_id: 'design', nodes: [{ id: 'task', name: '首页设计', status: 'in-progress', assignee: 'designer' }], tasks_detail: [{ task_id: 'task', status: 'submitted' }], edges: [], next: [], interrupts: [] };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><AssistantTaskNote room={room} rooms={[room]} contextOpen={false} onOpen={vi.fn()} /></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  useHitlInboxStore.setState({ confirmations: {}, pendingProjectKey: null, pendingChatRoomId: null });
  useSectionStore.setState({ activeSection: 'chat' });
  api.listProjects.mockResolvedValue({ projects: [{ project_id: 'project', title: '网站改版', team_id: 'design', status: 'active' }, { project_id: 'other', team_id: 'other', status: 'active' }], total: 2 });
  api.getProjectWorkflow.mockResolvedValue(wf);
});
afterEach(cleanup);

describe('assistant task note', () => {
  it('shows awaiting acceptance and opens the existing team-scoped project detail', async () => {
    setup();
    expect(await screen.findByText('首页设计')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /待验收/ })).toBeInTheDocument();
    expect(api.getProjectWorkflow).toHaveBeenCalledWith('project', { includeTasks: true, teamId: 'design' });
    expect(api.getProjectWorkflow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '查看任务：首页设计' }));
    expect(useHitlInboxStore.getState().pendingProjectKey).toEqual({ id: 'project', team: 'design' });
    expect(useSectionStore.getState().activeSection).toBe('tasks');
  });

  it('keeps actionable counts after collapsing and reopens without losing tasks', async () => {
    setup();
    await screen.findByText('首页设计');
    fireEvent.click(screen.getByRole('button', { name: '收起任务便签' }));
    expect(screen.queryByText('首页设计')).toBeNull();
    const open = screen.getByRole('button', { name: /展开任务便签，1 项待处理/ });
    fireEvent.click(open);
    expect(screen.getByText('首页设计')).toBeInTheDocument();
  });

  it('routes human confirmations to their original conversation without sending approval', async () => {
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId: room.id, eventId: '$approval', sender: '@leader:test', toolName: '发布', question: '现在发布吗？', timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '去确认：现在发布吗？' }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(room.id);
    expect(useHitlInboxStore.getState().confirmations.approval).toBeDefined();
  });

  it('reminds about newly actionable tasks while collapsed, once per state change', async () => {
    api.getProjectWorkflow.mockResolvedValue({ ...wf, tasks_detail: [{ task_id: 'task', status: 'in_progress' }] });
    const client = setup();
    await screen.findByText('首页设计');
    fireEvent.click(screen.getByRole('button', { name: '收起任务便签' }));
    act(() => client.setQueryData(['agentteams-project-workflow', 'design', 'project'], wf));
    await waitFor(() => expect(api.notify).toHaveBeenCalledTimes(1));
    act(() => client.setQueryData(['agentteams-project-workflow', 'design', 'project'], { ...wf }));
    expect(api.notify).toHaveBeenCalledTimes(1);
  });

  it('shows an update problem instead of claiming there are no tasks when the project list degrades', async () => {
    api.listProjects.mockResolvedValue({ projects: [], total: 0, degraded: true, error: 'unavailable' });
    setup();
    expect(await screen.findByText(/任务暂时无法更新/)).toBeInTheDocument();
    expect(screen.queryByText('暂时没有分配的任务')).toBeNull();
  });

  it('starts compact on mobile, opens as a note and can dismiss the overlay', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    setup();
    const open = await screen.findByRole('button', { name: /展开任务便签，1 项待处理/ });
    expect(screen.queryByRole('complementary', { name: '任务便签' })).toBeNull();
    fireEvent.click(open);
    expect(screen.getByText('首页设计')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起任务便签遮罩' }));
    expect(screen.queryByText('首页设计')).toBeNull();
  });

  it('shows failed, blocked and revision tasks separately from completed tasks', async () => {
    const states = ['failed', 'blocked', 'revision', 'completed'] as const;
    api.getProjectWorkflow.mockResolvedValue({ ...wf, nodes: states.map(status => ({ id: status, name: `${status}任务`, status: 'pending' })), tasks_detail: states.map(status => ({ task_id: status, status })) });
    setup();
    for (const title of ['失败', '阻塞', '需修订', '已完成']) expect(await screen.findByRole('heading', { name: new RegExp(title) })).toBeInTheDocument();
    expect(screen.getByText('3 项待处理')).toBeInTheDocument();
  });

  it('removes resolved confirmations from the compact reminder without hiding unrelated tasks', async () => {
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId: room.id, eventId: '$approval', sender: '@leader:test', toolName: '发布', timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    setup();
    await screen.findByText('首页设计');
    fireEvent.click(screen.getByRole('button', { name: '收起任务便签' }));
    expect(screen.getByRole('button', { name: /展开任务便签，2 项待处理/ })).toBeInTheDocument();
    act(() => useHitlInboxStore.getState().resolveConfirmation('approval', 'reviewer'));
    expect(screen.getByRole('button', { name: /展开任务便签，1 项待处理/ })).toBeInTheDocument();
  });
});
