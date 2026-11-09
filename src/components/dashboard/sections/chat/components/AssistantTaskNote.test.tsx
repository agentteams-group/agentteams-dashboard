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
  render(<QueryClientProvider client={client}><AssistantTaskNote room={room} rooms={[room]} /></QueryClientProvider>);
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

describe('human intervention entry', () => {
  async function open() {
    const trigger = await screen.findByRole('button', { name: /待我处理，1 项待处理/ });
    fireEvent.click(trigger);
  }

  it('starts collapsed and opens submitted task details in the correct team', async () => {
    setup();
    expect(screen.queryByText('首页设计')).toBeNull();
    await open();
    expect(screen.getByRole('heading', { name: /待验收/ })).toBeInTheDocument();
    expect(api.getProjectWorkflow).toHaveBeenCalledWith('project', { includeTasks: true, teamId: 'design' });
    fireEvent.click(screen.getByRole('button', { name: '查看任务：首页设计' }));
    expect(useHitlInboxStore.getState().pendingProjectKey).toEqual({ id: 'project', team: 'design' });
    expect(useSectionStore.getState().activeSection).toBe('tasks');
  });

  it('routes confirmation to the original conversation without approving it', async () => {
    api.getProjectWorkflow.mockResolvedValue({ ...wf, tasks_detail: [{ task_id: 'task', status: 'completed' }] });
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId: room.id, eventId: '$approval', sender: '@leader:test', toolName: '发布', question: '现在发布吗？', timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    setup();
    await open();
    fireEvent.click(screen.getByRole('button', { name: '去确认：现在发布吗？' }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(room.id);
    expect(useHitlInboxStore.getState().confirmations.approval).toBeDefined();
  });

  it('does not mix running or completed tasks into intervention items', async () => {
    const states = ['failed', 'blocked', 'revision', 'completed', 'in_progress'] as const;
    api.getProjectWorkflow.mockResolvedValue({ ...wf, nodes: states.map(status => ({ id: status, name: `${status}任务`, status: 'pending' })), tasks_detail: states.map(status => ({ task_id: status, status })) });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /待我处理，3 项待处理/ }));
    for (const title of ['失败', '阻塞', '需修订']) expect(screen.getByRole('heading', { name: new RegExp(title) })).toBeInTheDocument();
    expect(screen.queryByText('completed任务')).toBeNull();
    expect(screen.queryByText('in_progress任务')).toBeNull();
  });

  it('shows zero without opening an empty panel', async () => {
    api.getProjectWorkflow.mockResolvedValue({ ...wf, tasks_detail: [{ task_id: 'task', status: 'completed' }] });
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /待我处理，0 项待处理/ })).toBeDisabled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps update failures visible rather than treating them as an empty inbox', async () => {
    api.listProjects.mockResolvedValue({ projects: [], total: 0, degraded: true });
    setup();
    const trigger = await screen.findByRole('button', { name: /数据待更新/ });
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    expect(screen.getByText(/任务暂时无法更新/)).toBeInTheDocument();
  });

  it('reminds about newly actionable tasks while closed once per state change', async () => {
    api.getProjectWorkflow.mockResolvedValue({ ...wf, tasks_detail: [{ task_id: 'task', status: 'in_progress' }] });
    const client = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /待我处理，0 项待处理/ })).toBeDisabled());
    act(() => client.setQueryData(['agentteams-project-workflow', 'design', 'project'], wf));
    await waitFor(() => expect(api.notify).toHaveBeenCalledTimes(1));
    act(() => client.setQueryData(['agentteams-project-workflow', 'design', 'project'], { ...wf }));
    expect(api.notify).toHaveBeenCalledTimes(1);
  });
});
