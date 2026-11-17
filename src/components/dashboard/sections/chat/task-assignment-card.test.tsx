import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskAssignmentCard } from './task-assignment-card';

const fixture = vi.hoisted(() => ({ tasks: [] as import('@/hooks/use-task-board').BoardTask[] }));
vi.mock('@/hooks/use-projects', () => ({ useApiTaskBoard: () => ({ tasks: fixture.tasks }) }));
vi.mock('@/lib/api-base', () => ({ apiUrl: (url: string) => url, requestJson: async () => ({ history: [{ action: 'report_progress', note: '正在验证接单状态' }] }) }));
afterEach(() => { cleanup(); fixture.tasks = []; });
const notice = { kind: 'assigned' as const, title: '任务已分配', taskId: 'child', subject: '修复状态流转', body: 'original' };

it('updates the execution stage from canonical task status and opens real progress details', async () => {
  const task = { runId: 'child', title: '修复状态流转', status: 'assigned' as const, assignedTo: 'worker', roomId: '!source:test', dependsOn: [], createdAt: 1, source: 'controller', outcome: null };
  fixture.tasks = [task];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => <QueryClientProvider client={client}><TaskAssignmentCard notice={notice} sender="leader" timestamp={1} /></QueryClientProvider>;
  const rendered = render(view());
  expect(screen.getByText('已派发', { selector: '[aria-current="step"] span' })).toBeInTheDocument();
  fixture.tasks = [{ ...task, status: 'in_progress' }];
  rendered.rerender(view());
  expect(screen.getByText('执行中', { selector: '[aria-current="step"] span' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看执行详情' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('正在验证接单状态'));
});

it('keeps an unmatched historic assignment as a snapshot without claiming execution', () => {
  render(<QueryClientProvider client={new QueryClient()}><TaskAssignmentCard notice={notice} sender="leader" timestamp={1} /></QueryClientProvider>);
  expect(screen.getByText('派发时的通知，当前执行状态暂未同步。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看执行详情' })).toBeNull();
});
