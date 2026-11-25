import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationTaskTips } from './ConversationTaskTips';
import { TooltipProvider } from '@/components/ui/tooltip';
import { extractConfirmationFromEvent, useHitlInboxStore } from '@/lib/hitl-inbox';
import type { MatrixEvent } from '@/lib/matrix-api';
import { useSectionStore } from '@/lib/section-store';
import type { AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import type { IndexedTask } from '@/hooks/use-projects';
import type { WorkflowResponse } from '@/lib/agentteams-projects-api';
import type { RoomInfo } from '../room-info';

vi.mock('@/hooks/use-assistant-task-feed', () => ({ useAssistantTaskFeed: () => ({ workflows: [] }) }));
const index = vi.hoisted(() => ({ tasks: [] as IndexedTask[], archivedRooms: [] as { room_id: string }[], joinedRooms: [] as string[], projectedRooms: [] as RoomInfo[] }));
vi.mock('@/hooks/use-projects', () => ({ useTaskIndex: () => ({ data: { tasks: index.tasks } }) }));
vi.mock('@/hooks/use-room-archive', () => ({ useArchivedRooms: () => ({ data: { rooms: index.archivedRooms } }) }));
vi.mock('@/hooks/use-chat-room-access', () => ({ useChatRoomAccess: () => ({ state: 'joined', joinedRooms: [...index.joinedRooms, ...index.projectedRooms.filter(room => room.access === 'joined').map(room => room.id)] }) }));
const room: RoomInfo = { id: '!assistant:test', name: '平台助手', type: 'manager', agentRole: 'operations', members: [], access: 'joined' };
const execution: RoomInfo = { id: '!execution:test', name: '网站改版', type: 'project', projectId: 'project', teamId: 'design', members: [], access: 'joined' };
const workflow: WorkflowResponse = {
  project_id: 'project', title: '网站改版', team_id: 'design', source_room_id: room.id, status: 'active',
  nodes: [{ id: 'task', name: '首页设计', status: 'in-progress', assignee: 'designer' }],
  tasks_detail: [{ task_id: 'task', status: 'in_progress', room_id: execution.id, summary: '正在生成设计稿' }],
  edges: [], next: [], interrupts: [],
};
const feed = (workflows = [workflow]): AssistantTaskFeed => ({ workflows: workflows.map(workflow => ({ ...workflow, team_id: workflow.team_id })), loading: false, degraded: false, partialError: false, refresh: vi.fn() });

function view(taskFeed = feed(), rooms = [room, execution]) {
  index.projectedRooms = rooms;
  return <QueryClientProvider client={new QueryClient()}><TooltipProvider delayDuration={0}>
    <ConversationTaskTips room={room} taskFeed={taskFeed} />
  </TooltipProvider></QueryClientProvider>;
}

const triggerOptions = { name: /^当前对话的任务，共/ };

function renderOpen(...args: Parameters<typeof view>) {
  const result = render(view(...args));
  const trigger = screen.queryByRole('button', triggerOptions);
  if (trigger) fireEvent.click(trigger);
  return result;
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-18T08:36:00Z'));
  index.tasks = [];
  index.archivedRooms = [];
  index.joinedRooms = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useHitlInboxStore.setState({ confirmations: {}, pendingChatRoomId: null, pendingProjectKey: null });
  useSectionStore.setState({ activeSection: 'chat' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('conversation task tips', () => {
  it('shows creation time and elapsed time, and opens a joined task room even before its name syncs', () => {
    const roomId = '!standalone:test';
    index.joinedRooms = [roomId];
    index.tasks = [{ task_id: 'standalone', main_task_id: 'standalone', title: '独立任务', status: 'in_progress', source_room_id: room.id, room_id: roomId, created_at: '2026-11-18T08:26:00Z' }];
    renderOpen(feed([]));
    expect(screen.getByText(/创建于/).querySelector('time')).toHaveAttribute('datetime', '2026-11-18T08:26:00Z');
    expect(screen.getByText('耗时 10 分 00 秒')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '独立任务，执行中，进入协作空间' }));
    expect(useSectionStore.getState().taskCollaboration).toEqual({ taskId: 'standalone', roomId });
  });

  it('updates active elapsed time every second without waiting for new task data or replacing the row', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-18T08:36:00Z'));
    const taskId = 'standalone';
    index.tasks = [{ task_id: taskId, main_task_id: taskId, title: '独立任务', status: 'assigned', source_room_id: room.id, created_at: '2026-11-18T08:35:58Z' }];
    renderOpen(feed([]));
    const row = screen.getByRole('button', { name: /^独立任务，已分配/ });
    expect(row).toHaveTextContent('耗时 2 秒');
    expect(screen.queryByLabelText('任务执行中')).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(row).toHaveTextContent('耗时 3 秒');
  });

  it('removes archived task rooms and their counts even while the task index and workflow still report running', async () => {
    const roomId = '!standalone:test';
    index.tasks = [{ task_id: 'standalone', main_task_id: 'standalone', title: '独立任务', status: 'in_progress', source_room_id: room.id, room_id: roomId }];
    const { rerender } = renderOpen();
    expect(screen.getByRole('button', triggerOptions)).toHaveAccessibleName('当前对话的任务，共 2 项');
    index.archivedRooms = [{ room_id: roomId }];
    rerender(view());
    await waitFor(() => expect(screen.queryByText('独立任务')).toBeNull());
    expect(screen.getByRole('button', triggerOptions)).toHaveAccessibleName('当前对话的任务，共 1 项');
    index.archivedRooms.push({ room_id: execution.id });
    rerender(view());
    await waitFor(() => expect(screen.queryByRole('button', triggerOptions)).toBeNull());
  });

  it('shows independent main tasks alongside project tasks and opens their exact task room', () => {
    const taskRoom: RoomInfo = { ...execution, id: '!standalone:test' };
    index.tasks = [{ task_id: 'standalone', main_task_id: 'standalone', title: '独立任务', status: 'assigned', source_room_id: room.id, room_id: taskRoom.id }];
    renderOpen(feed(), [room, execution, taskRoom]);
    expect(screen.getByRole('button', triggerOptions)).toHaveAccessibleName('当前对话的任务，共 2 项');
    fireEvent.click(screen.getByRole('button', { name: '独立任务，已分配，进入协作空间' }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(taskRoom.id);
  });
  it('shows a running task without requiring human intervention and opens its execution room', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: '首页设计，执行中，进入协作空间' }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(execution.id);
    expect(useHitlInboxStore.getState().pendingProjectKey).toBeNull();
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('shows task name, status and duration directly without a hover interaction', () => {
    const history = [{ ts: '2026-11-14T09:55:00Z', from: 'planned', to: 'prepared', action: 'delegate_task' }, { ts: '2026-11-14T10:00:00Z', to: 'in_progress', action: 'ack_task' }, { ts: '2026-11-14T10:33:00Z', to: 'submitted', action: 'submit_task' }];
    renderOpen(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', room_id: execution.id, status: 'submitted', history }] }]));
    expect(screen.getByText('首页设计')).toBeVisible();
    expect(screen.getByText('待验收')).toBeVisible();
    expect(screen.getByLabelText('任务待验收')).not.toHaveClass('animate-spin');
    expect(screen.getByText(/创建于/).querySelector('time')).toHaveAttribute('datetime', '2026-11-14T09:55:00Z');
    expect(screen.getByText('耗时 33 分 00 秒')).toBeVisible();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('can collapse and expand while retaining a warning about tasks needing attention', () => {
    renderOpen(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', room_id: execution.id, status: 'failed' }] }]));
    fireEvent.click(screen.getByRole('button', triggerOptions));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('1 项需要关注')).toBeVisible();
    fireEvent.click(screen.getByRole('button', triggerOptions));
    expect(screen.getByText('首页设计')).toBeVisible();
    expect(screen.getByText('失败')).toBeVisible();
  });

  it('distinguishes running, blocked and failed tasks with visible status indicators', () => {
    const statuses = ['in_progress', 'blocked', 'failed'];
    renderOpen(feed([{ ...workflow, nodes: statuses.map(status => ({ id: status, name: status, status: 'pending' })), tasks_detail: statuses.map(status => ({ task_id: status, status })) }]));
    expect(screen.getByLabelText('任务执行中')).toHaveClass('animate-spin');
    expect(screen.getByLabelText('任务阻塞')).toBeVisible();
    expect(screen.getByLabelText('任务失败')).toBeVisible();
    expect(screen.getByText('阻塞')).toBeVisible();
  });

  it('shows an approval prompt only for the matching task room and assignee', () => {
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId: execution.id, eventId: '$approval', sender: 'designer', toolName: 'Bash', runtimeApproval: true, timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    renderOpen();
    expect(screen.getByText('待审批')).toBeVisible();
    expect(screen.getByLabelText('任务需要审批')).toBeVisible();
    expect(screen.queryByLabelText('任务执行中')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /首页设计，待审批，进入协作空间/ }));
    expect(useHitlInboxStore.getState().confirmations.approval).toBeDefined();
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(execution.id);
  });

  it.each(['openclaw', 'qwenpaw', 'hermes', 'deepseek-harness', 'openhuman', 'codex'])('shows the pending tool approval from %s in the task panel', runtime => {
    const native = runtime === 'qwenpaw' || runtime === 'codex';
    const event = {
      event_id: '$approval', sender: 'designer', type: 'm.room.message', origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'Tool approval', ...(native
        ? { 'org.agentteams.approval': { version: 1, runtime, request_id: 'approval', context_id: 'ctx-1', status: 'pending', tool_name: 'bash' } }
        : { 'org.agentteams.run': { version: '1', blocks: [{ type: 'confirmation', confirmation_id: 'approval', tool_name: 'bash' }] } }) },
    } as MatrixEvent;
    const confirmation = extractConfirmationFromEvent(event, execution.id)!;
    expect(confirmation).not.toBeNull();
    useHitlInboxStore.setState({ confirmations: { [confirmation.id]: confirmation } });
    renderOpen();
    expect(screen.getByText('待审批')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /首页设计，待审批，进入协作空间/ }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(execution.id);
    expect(useHitlInboxStore.getState().confirmations[confirmation.id]).toEqual(confirmation);
  });

  it('marks an intervention question as pending confirmation rather than tool approval', () => {
    useHitlInboxStore.setState({ confirmations: { question: { id: 'question', roomId: execution.id, eventId: '$question', sender: 'designer', toolName: 'intervention', question: '请选择方案', timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    renderOpen();
    expect(screen.queryByText('待审批')).toBeNull();
    expect(screen.getByText('待确认')).toBeVisible();
    expect(screen.getByLabelText('任务待确认')).not.toHaveClass('animate-spin');
  });

  it.each([['!unrelated:test', 'designer'], [execution.id, 'other-worker']])('does not attribute an unrelated approval to this task (%s, %s)', (roomId, sender) => {
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId, eventId: '$approval', sender, toolName: 'Bash', runtimeApproval: true, timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    renderOpen();
    expect(screen.queryByText('待审批')).toBeNull();
    expect(screen.getByLabelText('任务执行中')).toBeVisible();
  });

  it('reflects new task status', async () => {
    const { rerender } = renderOpen();
    rerender(view(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', status: 'completed', room_id: execution.id }] }])));
    await waitFor(() => expect(screen.queryByRole('button', triggerOptions)).toBeNull());
  });

  it('hides an accepted task while raw execution detail still says submitted', () => {
    renderOpen(feed([{ ...workflow, nodes: [{ ...workflow.nodes[0], status: 'completed' }], tasks_detail: [{ task_id: 'task', status: 'submitted', room_id: execution.id }] }]));
    expect(screen.queryByRole('button', triggerOptions)).toBeNull();
  });

  it('excludes completed tasks from the visible list and count', () => {
    renderOpen(feed([{ ...workflow, nodes: [...workflow.nodes, { id: 'done', name: '已完成的任务', status: 'completed' }] }]));
    expect(screen.queryByText('已完成的任务')).toBeNull();
    expect(screen.getByRole('button', triggerOptions)).toHaveAccessibleName('当前对话的任务，共 1 项');
  });

  it('keeps missing or unjoined execution rooms from producing a dead chat link', () => {
    renderOpen(feed(), [room, { ...execution, access: 'not-joined' }]);
    expect(screen.getByRole('button', { name: /协作空间暂不可用/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: /协作空间暂不可用/ }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(useHitlInboxStore.getState().pendingProjectKey).toBeNull();
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('does not guess another task room in the same project when its own room is missing', () => {
    renderOpen(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', status: 'planned' }] }]));
    fireEvent.click(screen.getByRole('button', { name: /协作空间暂不可用/ }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
  });

  it('shows stale status explicitly when a background refresh fails', () => {
    renderOpen({ ...feed(), partialError: true });
    expect(screen.getByRole('status')).toHaveTextContent('状态待更新');
  });

  it('does not show unrelated platform tasks in the conversation', () => {
    renderOpen(feed([{ ...workflow, source_room_id: '!other:test' }]));
    expect(screen.queryByRole('button', triggerOptions)).toBeNull();
  });
});
