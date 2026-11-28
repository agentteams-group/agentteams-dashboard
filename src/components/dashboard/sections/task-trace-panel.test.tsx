import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TaskTracePanel } from './task-trace-panel';
import type { TaskTraceBundle } from '@/lib/task-tracing';

it('shows task overview and per-Agent shares above every expandable trace', async () => {
  const bundle: TaskTraceBundle = { task_id: 'main', team_id: 'team', queried_at: '2026-11-27T00:00:10Z', retrieval_complete: true, tasks: [], causal_links: [], gaps: [], traces: [
    { trace: { id: 'one', name: 'native.turn', userId: 'developer', sessionId: null, timestamp: '2026-11-27T00:00:00Z', tags: [], metadata: {} }, observations: [{ id: 'model', name: 'model.call', parentObservationId: null, type: 'GENERATION', level: 'DEFAULT', startTime: '2026-11-27T00:00:00Z', endTime: '2026-11-27T00:00:10Z', usage: { total: 100 }, input: 'actual input' }] },
  ] };
  const view = render(<TaskTracePanel bundle={bundle} />);
  expect(screen.getByText('总时间跨度')).toBeTruthy();
  expect(screen.queryByText('任务执行概览')).toBeNull();
  expect(screen.getByLabelText('所选 Agent 执行统计')).toBeTruthy();
  expect(screen.getByText('developer', { selector: 'summary p' }).closest('details')!.open).toBe(true);
  expect(screen.getByRole('button', { name: '查看步骤 model.call' })).toBeTruthy();
  expect(screen.getByText('参与 Agent')).toBeTruthy();
  expect(screen.getAllByText('100.0%').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText('developer', { selector: 'summary p' }).closest('summary')!);
  // jsdom does not implement the browser's native details toggle.
  const run = screen.getByText('developer', { selector: 'summary p' }).closest('details')!;
  run.open = true; fireEvent(run, new Event('toggle'));
  expect(await screen.findByText('native.turn')).toBeTruthy();
  expect(screen.getByText('model.call')).toBeTruthy();
  expect(screen.queryByText(/actual input/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看步骤 model.call' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getByText(/actual input/)).toBeTruthy();
  view.unmount();
});

it('defaults to the largest consumer and switches the full flow from the chart or legend', async () => {
  const bundle: TaskTraceBundle = { task_id: 'main', team_id: 'team', queried_at: '2026-11-27T00:00:10Z', retrieval_complete: true, tasks: [], causal_links: [], gaps: [], traces: [100, 40].map((tokens, index) => ({
    trace: { id: String(index), name: 'native', userId: index ? 'tester' : 'developer', sessionId: null, timestamp: '2026-11-27T00:00:00Z', tags: [], metadata: {} },
    observations: [{ id: 'model', name: 'model', parentObservationId: null, type: 'GENERATION', level: 'DEFAULT', startTime: '2026-11-27T00:00:00Z', endTime: '2026-11-27T00:00:10Z', usage: { total: tokens } }],
  })) };
  const view = render(<TaskTracePanel bundle={bundle} />);
  const flow = screen.getByLabelText('完整 Trace 流');
  expect(within(flow).getByText('developer', { selector: 'summary p' })).toBeTruthy();
  expect(within(flow).queryByText('tester', { selector: 'summary p' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /选择 tester，Token 占比/ }));
  expect(within(flow).getByText('tester', { selector: 'summary p' })).toBeTruthy();
  expect(within(flow).queryByText('developer', { selector: 'summary p' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看 developer 的 Trace' }));
  expect(within(flow).getByText('developer', { selector: 'summary p' })).toBeTruthy();
  view.unmount();
});
