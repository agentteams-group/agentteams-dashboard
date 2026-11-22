import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoardTask } from '@/hooks/use-task-board';
import { useHitlInboxStore, type HitlConfirmation } from '@/lib/hitl-inbox';
import { RoomTaskActivity } from './RoomTaskActivity';

afterEach(() => {
  cleanup();
  useHitlInboxStore.setState({ confirmations: {} });
});

const roomId = '!assistant:local';
const historical: BoardTask = {
  runId: 'historical',
  teamId: 'design',
  title: '已存在的任务',
  kind: 'main',
  roomId,
  executionRoomId: '!execution:local',
  status: 'in_progress',
  assignedTo: 'designer',
  dependsOn: [],
  createdAt: 1,
  outcome: null,
  source: 'api',
};

const updateFlightCount = vi.fn();

function activity(tasks: BoardTask[]) {
  return <RoomTaskActivity roomId={roomId} platformAssistant={false} managedTeam="design" managedTeamLabel="体验设计团队" panelOpen={false} onFlightCountChange={updateFlightCount}
    data={{ board: { tasks }, roots: tasks, snapshots: [], count: tasks.length }} />;
}

it('announces new tasks from the current chat and meaningful transitions without replaying existing tasks', () => {
  const completed = { ...historical, runId: 'old-complete', status: 'completed' as const };
  const elsewhere = { ...historical, runId: 'elsewhere', teamId: 'another-team', roomId: '!other-team:local', title: '其他团队任务' };
  const sameTeamElsewhere = { ...historical, runId: 'design-elsewhere', teamId: '体验设计团队', roomId: '!another-chat:local', title: '同团队其他会话任务' };
  const { rerender } = render(activity([historical, completed, elsewhere, sameTeamElsewhere]));
  const notices = within(screen.getByRole('status'));
  expect(notices.queryByText('任务已完成')).toBeNull();
  expect(notices.queryByText('任务已创建，进展会通知')).toBeNull();

  const created = { ...historical, runId: 'created', title: '本会话新任务', createdAt: Date.now(), executionRoomId: '!new:local' };
  rerender(activity([historical, completed, created, elsewhere, sameTeamElsewhere]));
  expect(notices.getByText('任务已创建，进展会通知')).toBeInTheDocument();
  expect(notices.getByText('本会话新任务')).toBeInTheDocument();

  const changed = [
    { ...historical, status: 'completed' as const }, completed, created,
    { ...elsewhere, status: 'failed' as const }, { ...sameTeamElsewhere, status: 'submitted' as const },
  ];
  rerender(activity(changed));
  rerender(activity([...changed]));
  expect(notices.getAllByText('任务已完成')).toHaveLength(1);
  expect(notices.getByText('需要确认')).toBeInTheDocument();
  expect(notices.getByText('同团队其他会话任务')).toBeInTheDocument();
  expect(notices.queryByText('其他团队任务')).toBeNull();

  rerender(activity(changed.map(task => task.runId === 'created' ? { ...task, status: 'failed' } : task)));
  expect(notices.getByText('任务执行异常')).toBeInTheDocument();
});

it('links new execution-room approvals and questions to their task', () => {
  const request: HitlConfirmation = {
    id: 'approval',
    eventId: '$approval',
    roomId: '!execution:local',
    sender: '@designer:local',
    toolName: 'example',
    approveReply: '/approve',
    rejectReply: '/reject',
    timestamp: 1,
  };
  useHitlInboxStore.setState({ confirmations: { old: { ...request, id: 'old' } } });
  render(activity([historical]));
  expect(screen.queryByText('需要审批')).toBeNull();

  act(() => useHitlInboxStore.setState({ confirmations: {
    approval: { ...request, timestamp: Date.now() },
    question: { ...request, id: 'question', eventId: '$question', question: '继续吗？', timestamp: Date.now() },
    unrelated: { ...request, id: 'unrelated', roomId: '!unrelated:local', timestamp: Date.now() },
  } }));
  expect(screen.getAllByText('需要审批')).toHaveLength(1);
  expect(screen.getByText('需要确认')).toBeInTheDocument();
  expect(screen.getAllByText('已存在的任务')).toHaveLength(2);
});
