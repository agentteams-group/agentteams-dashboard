import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

  it.each(['ask_human', 'shell'])('does not duplicate a %s request above the composer', (toolName) => {
    useHitlInboxStore.getState().upsertConfirmation({
      id: 'c1', roomId: '!room:test', eventId: '$e1', sender: '@agent:test',
      toolName, ...(toolName === 'ask_human' ? { question: '先运行测试吗？' } : {}),
      approveReply: '/approve', rejectReply: '拒绝', timestamp: Date.now(),
    });
    const { container } = render(<AgentActivityTrack roomId="!room:test" />);
    expect(container).toBeEmptyDOMElement();
  });
});
