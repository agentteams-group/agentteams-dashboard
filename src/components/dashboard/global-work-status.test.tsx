import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { GlobalWorkStatus } from './global-work-status';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

const feed = vi.hoisted(() => ({ workflows: [] as unknown[], loading: false, degraded: false, partialError: false }));
vi.mock('@/hooks/use-assistant-task-feed', () => ({ useAssistantTaskFeed: () => feed }));
afterEach(() => { cleanup(); feed.workflows = []; feed.loading = false; feed.degraded = false; feed.partialError = false; });

it('counts raw submitted tasks separately and opens the matching team project', () => {
  feed.workflows = [{ project_id: 'project', team_id: 'team', title: '团队项目', nodes: ['running', 'submitted', 'failed', 'completed'].map(status => ({ id: status, name: `${status}任务`, status: 'in-progress' })), tasks_detail: ['running', 'submitted', 'failed', 'completed'].map(status => ({ task_id: status, status })), interrupts: [] }];
  const navigate = vi.fn();
  render(<GlobalWorkStatus onNavClick={navigate} />);
  expect(screen.getByRole('button', { name: '进行中 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '异常 1' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '待验收 1' }));
  expect(screen.queryByText('completed任务')).toBeNull();
  expect(screen.queryByText('running任务')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /submitted任务/ }));
  expect(useHitlInboxStore.getState().pendingProjectKey).toEqual({ id: 'project', team: 'team' });
  expect(navigate).toHaveBeenCalledWith('tasks');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not report loading or unavailable data as zero', () => {
  feed.loading = true;
  const { rerender } = render(<GlobalWorkStatus onNavClick={vi.fn()} />);
  expect(screen.getByRole('button', { name: '进行中 …' })).toBeInTheDocument();
  feed.loading = false;
  feed.partialError = true;
  rerender(<GlobalWorkStatus onNavClick={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '异常 —' }));
  expect(screen.getByRole('status')).toHaveTextContent('无法完整更新');
  expect(screen.queryByText('暂无异常任务')).toBeNull();
});

it('shows an actual empty list when no tasks are present', () => {
  render(<GlobalWorkStatus onNavClick={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '进行中 0' }));
  expect(screen.getByText('暂无进行中任务')).toBeInTheDocument();
});
