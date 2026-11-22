import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardTask } from '@/hooks/use-task-board';
import { taskMetaQuery } from '../../task-detail-sheet';
import { TaskTopologyPopover } from './TaskTopologyPopover';
import { RoomContextTabs } from './RoomContextTabs';

const roomId = '!room:test';
const main: BoardTask = {
  runId: 'main', kind: 'main', teamId: 'travel', roomId: '!assistant:test', executionRoomId: roomId,
  title: '南京旅行规划', assignedTo: 'travel-leader', status: 'in_progress', source: 'api', dependsOn: [], createdAt: 1, outcome: null,
};
const itinerary: BoardTask = { ...main, runId: 'itinerary', kind: undefined, parentTaskId: main.runId, assignedTo: 'planner', title: '行程规划', status: 'completed' };
const budget: BoardTask = { ...itinerary, runId: 'budget', title: '美食预算', status: 'assigned', dependsOn: [itinerary.runId] };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function topology(tasks: BoardTask[] = [main, itinerary, budget]) {
  return <QueryClientProvider client={client}>
    <TaskTopologyPopover roomId={roomId} taskId={main.runId} roomTaskData={{ board: { tasks }, roots: [tasks[0]], snapshots: [], count: 1 }} />
  </QueryClientProvider>;
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  client.setQueryData(taskMetaQuery(main.runId, main.teamId).queryKey, {
    summary: '两天一晚行程，包含美食和预算',
    history: [{ action: 'report_progress', note: '行程初稿已提交' }],
  });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps file and member tabs while task rooms use the separate topology popover', () => {
  const select = vi.fn();
  render(<RoomContextTabs activeTab="files" showTasks={false} onTabChange={select} />);
  expect(screen.queryByRole('button', { name: '任务' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '成员' }));
  expect(select).toHaveBeenCalledWith('members');
  expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument();
});

it('opens on click without inserting a fixed graph into the conversation', () => {
  render(topology());
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '任务拓扑' }));
  expect(screen.getByRole('dialog', { name: '任务拓扑' })).toBeInTheDocument();
  expect(screen.getByText('两天一晚行程，包含美食和预算')).toBeVisible();
  expect(screen.getByText('行程初稿已提交')).toBeVisible();
  expect(screen.getByText('子任务 1/2 已完成')).toBeVisible();
  expect(screen.getByRole('group', { name: '任务依赖图' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '美食预算 · planner' }));
  expect(screen.getByText('所选任务：美食预算')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '任务拓扑' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('waits for hover intent and stays open when moving into the preview', () => {
  vi.useFakeTimers();
  render(topology());
  const trigger = screen.getByRole('button', { name: '任务拓扑' });
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(250));
  const preview = screen.getByRole('dialog');
  fireEvent.pointerLeave(trigger);
  fireEvent.pointerEnter(preview);
  act(() => vi.advanceTimersByTime(250));
  expect(preview).toBeInTheDocument();
  fireEvent.pointerLeave(preview);
  act(() => vi.advanceTimersByTime(250));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('updates progress while open and draws an undecomposed task as a single node', () => {
  const { rerender } = render(topology([main]));
  fireEvent.click(screen.getByRole('button', { name: '任务拓扑' }));
  expect(screen.getByRole('button', { name: '南京旅行规划 · travel-leader' })).toBeVisible();
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(topology([main, itinerary, { ...budget, runId: 'main-budget', title: 'main-budget', status: 'completed' }]));
  expect(screen.getByRole('button', { name: 'budget · planner' })).toBeVisible();
  expect(screen.getByText('子任务 2/2 已完成')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
});
