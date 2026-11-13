import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationTaskTips } from './ConversationTaskTips';
import { TooltipProvider } from '@/components/ui/tooltip';
import { extractConfirmationFromEvent, useHitlInboxStore } from '@/lib/hitl-inbox';
import type { MatrixEvent } from '@/lib/matrix-api';
import { useSectionStore } from '@/lib/section-store';
import type { AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import type { WorkflowResponse } from '@/lib/agentteams-projects-api';
import type { RoomInfo } from '../room-info';

vi.mock('@/hooks/use-assistant-task-feed', () => ({ useAssistantTaskFeed: () => ({ workflows: [] }) }));
vi.mock('@/hooks/use-worker-session-state', () => ({ useSessionTick: () => Date.now() }));
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
  return <QueryClientProvider client={new QueryClient()}><TooltipProvider delayDuration={0}>
    <ConversationTaskTips room={room} rooms={rooms} taskFeed={taskFeed} />
  </TooltipProvider></QueryClientProvider>;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useHitlInboxStore.setState({ confirmations: {}, pendingChatRoomId: null, pendingProjectKey: null });
  useSectionStore.setState({ activeSection: 'chat' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('conversation task tips', () => {
  it('shows a running task without requiring human intervention and opens its execution room', () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: '首页设计，执行中，进入协作空间' }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(execution.id);
    expect(useHitlInboxStore.getState().pendingProjectKey).toBeNull();
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('shows task name, status and duration directly without a hover interaction', () => {
    const history = [{ ts: '2026-11-14T10:00:00Z', to: 'in_progress', action: 'ack_task' }, { ts: '2026-11-14T10:33:00Z', to: 'submitted', action: 'submit_task' }];
    render(view(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', room_id: execution.id, status: 'submitted', history }] }])));
    expect(screen.getByText('首页设计')).toBeVisible();
    expect(screen.getByText('待验收')).toBeVisible();
    expect(screen.getByText('耗时 33 分钟')).toBeVisible();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('can collapse and expand while retaining a warning about tasks needing attention', () => {
    render(view(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', room_id: execution.id, status: 'failed' }] }])));
    fireEvent.click(screen.getByRole('button', { name: '收起对话任务' }));
    expect(screen.queryByText('首页设计')).toBeNull();
    expect(screen.getByLabelText('1 项需要关注')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '展开对话任务' }));
    expect(screen.getByText('首页设计')).toBeVisible();
    expect(screen.getByText('失败')).toBeVisible();
  });

  it('distinguishes running, blocked and failed tasks with visible status indicators', () => {
    const statuses = ['in_progress', 'blocked', 'failed'];
    render(view(feed([{ ...workflow, nodes: statuses.map(status => ({ id: status, name: status, status: 'pending' })), tasks_detail: statuses.map(status => ({ task_id: status, status })) }])));
    expect(screen.getByLabelText('任务执行中')).toHaveClass('animate-spin');
    expect(screen.getByLabelText('任务阻塞')).toBeVisible();
    expect(screen.getByLabelText('任务失败')).toBeVisible();
    expect(screen.getByText('阻塞')).toBeVisible();
  });

  it('shows an approval prompt only for the matching task room and assignee', () => {
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId: execution.id, eventId: '$approval', sender: 'designer', toolName: 'Bash', runtimeApproval: true, timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    render(view());
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
    render(view());
    expect(screen.getByText('待审批')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /首页设计，待审批，进入协作空间/ }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(execution.id);
    expect(useHitlInboxStore.getState().confirmations[confirmation.id]).toEqual(confirmation);
  });

  it('does not label an intervention question as a tool approval', () => {
    useHitlInboxStore.setState({ confirmations: { question: { id: 'question', roomId: execution.id, eventId: '$question', sender: 'designer', toolName: 'intervention', question: '请选择方案', timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    render(view());
    expect(screen.queryByText('待审批')).toBeNull();
  });

  it.each([['!unrelated:test', 'designer'], [execution.id, 'other-worker']])('does not attribute an unrelated approval to this task (%s, %s)', (roomId, sender) => {
    useHitlInboxStore.setState({ confirmations: { approval: { id: 'approval', roomId, eventId: '$approval', sender, toolName: 'Bash', runtimeApproval: true, timestamp: 1, approveReply: 'yes', rejectReply: 'no' } } });
    render(view());
    expect(screen.queryByText('待审批')).toBeNull();
    expect(screen.getByLabelText('任务执行中')).toBeVisible();
  });

  it('reflects new task status', () => {
    const { rerender } = render(view());
    rerender(view(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', status: 'completed', room_id: execution.id }] }])));
    expect(screen.queryByRole('region', { name: '当前对话的任务' })).toBeNull();
  });

  it('excludes completed tasks from the visible list and count', () => {
    render(view(feed([{ ...workflow, nodes: [...workflow.nodes, { id: 'done', name: '已完成的任务', status: 'completed' }] }])));
    expect(screen.queryByText('已完成的任务')).toBeNull();
    expect(screen.getByRole('button', { name: '收起对话任务' })).toHaveTextContent('任务 1');
  });

  it('keeps missing or unjoined execution rooms from producing a dead chat link', () => {
    render(view(feed(), [room, { ...execution, access: 'not-joined' }]));
    expect(screen.getByRole('button', { name: /协作空间暂不可用/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: /协作空间暂不可用/ }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(useHitlInboxStore.getState().pendingProjectKey).toBeNull();
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('does not guess another task room in the same project when its own room is missing', () => {
    render(view(feed([{ ...workflow, tasks_detail: [{ task_id: 'task', status: 'planned' }] }])));
    fireEvent.click(screen.getByRole('button', { name: /协作空间暂不可用/ }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
  });

  it('shows stale status explicitly when a background refresh fails', () => {
    render(view({ ...feed(), partialError: true }));
    expect(screen.getByRole('status')).toHaveTextContent('状态待更新');
  });

  it('does not show unrelated platform tasks in the conversation', () => {
    render(view(feed([{ ...workflow, source_room_id: '!other:test' }])));
    expect(screen.queryByRole('region')).toBeNull();
  });
});
