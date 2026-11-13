import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentActivityTrack } from './agent-activity-track';
import { useTaskStore } from '@/lib/task-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

afterEach(() => {
  cleanup();
  useTaskStore.getState().clearTasks();
  useHitlInboxStore.setState({ confirmations: {}, resolutions: {} });
});

describe('AgentActivityTrack', () => {
  it('renders nothing when the room has no task or HITL item', () => {
    const { container } = render(<AgentActivityTrack roomId="!room:test" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the active task title and step progress', () => {
    useTaskStore.getState().upsertTask({
      runId: 'run-1',
      title: '巡检日志',
      status: 'running',
      roomId: '!room:test',
      senderMatrixUserId: '@mgr:test',
      subagents: [],
      steps: [
        { title: 'a', status: 'done' },
        { title: 'b', status: 'running' },
      ],
    });
    render(<AgentActivityTrack roomId="!room:test" />);
    expect(screen.getByText('巡检日志 · 1/2')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('prefers a pending HITL confirmation over the task', () => {
    useTaskStore.getState().upsertTask({
      runId: 'run-1',
      title: '巡检日志',
      status: 'running',
      roomId: '!room:test',
      senderMatrixUserId: '@mgr:test',
      subagents: [],
      steps: [],
    });
    useHitlInboxStore.getState().upsertConfirmation({
      id: 'c1',
      roomId: '!room:test',
      eventId: '$e1',
      sender: '@agent:test',
      toolName: 'shell',
      triggeredBy: 'worker-a',
      approveReply: '/approve',
      rejectReply: '拒绝',
      timestamp: Date.now(),
    });
    render(<AgentActivityTrack roomId="!room:test" />);
    expect(screen.getByText('有操作等你审批')).toBeInTheDocument();
    expect(screen.getByText('查看具体操作后，选择批准或拒绝。')).toBeInTheDocument();
    expect(screen.queryByText('HITL')).not.toBeInTheDocument();
    expect(screen.queryByText('巡检日志')).toBeNull();
  });

  it('shows the question and locates its exact message without exposing internal names', () => {
    useHitlInboxStore.getState().upsertConfirmation({ id: 'q1', roomId: '!room:test', eventId: '$question', sender: '@agent:test', toolName: 'ask_human', question: '先运行测试还是先审查变更？', approveReply: '', rejectReply: '', timestamp: Date.now() });
    const reveal = vi.fn(() => true);
    render(<AgentActivityTrack roomId="!room:test" onReveal={reveal} />);
    expect(screen.getByText('有问题等你回答')).toBeInTheDocument();
    expect(screen.getByText('先运行测试还是先审查变更？')).toBeInTheDocument();
    expect(screen.queryByText(/ask_human|HITL/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看问题' }));
    expect(reveal).toHaveBeenCalledWith('$question');
  });

  it('explains when the target is outside loaded history', () => {
    useHitlInboxStore.getState().upsertConfirmation({ id: 'c1', roomId: '!room:test', eventId: '$old', sender: '@agent:test', toolName: 'shell', approveReply: '/approve', rejectReply: '拒绝', timestamp: 1 });
    render(<AgentActivityTrack roomId="!room:test" onReveal={() => false} />);
    fireEvent.click(screen.getByRole('button', { name: '查看审批' }));
    expect(screen.getByRole('status')).toHaveTextContent('该请求在更早的消息中');
  });

  it('does not ask for another decision while the submitted answer awaits its receipt', () => {
    useHitlInboxStore.getState().upsertConfirmation({ id: 'c1', roomId: '!room:test', eventId: '$e', sender: '@agent:test', toolName: 'shell', approveReply: '/approve', rejectReply: '拒绝', timestamp: 1 });
    useHitlInboxStore.getState().submitConfirmation('c1', '@me:test', 'approved');
    const { container } = render(<AgentActivityTrack roomId="!room:test" onReveal={() => true} />);
    expect(container).toBeEmptyDOMElement();
  });
});
