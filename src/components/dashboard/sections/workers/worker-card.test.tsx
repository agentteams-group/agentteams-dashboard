import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkerCard } from './worker-card';
import { clearToolCallLedger, recordToolCalls } from '@/lib/tool-call-counter';
import type { WorkerResponse } from '@/lib/agentteams-api';

function makeWorker(overrides: Partial<WorkerResponse> = {}): WorkerResponse {
  return {
    name: 'worker-a',
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: 'gpt-5',
    runtime: 'qwenpaw',
    image: 'img:latest',
    containerState: 'running',
    matrixUserID: '@worker-a:server',
    roomID: '!room:server',
    message: '',
    team: 'team-alpha',
    role: 'member',
    ...overrides,
  };
}

function renderCard(
  worker: WorkerResponse,
  opts: { isDeleting?: boolean; isActionPending?: boolean; isRestarting?: boolean } = {},
) {
  const handlers = {
    onToggleSelect: vi.fn(),
    onView: vi.fn(),
    onOpenDrawer: vi.fn(),
    onRestart: vi.fn(),
    onWake: vi.fn(),
    onSleep: vi.fn(),
  };
  render(
    <TooltipProvider>
      <WorkerCard
        worker={worker}
        index={0}
        isSelected={false}
        onToggleSelect={handlers.onToggleSelect}
        onView={handlers.onView}
        onOpenDrawer={handlers.onOpenDrawer}
        onRestart={handlers.onRestart}
        onWake={handlers.onWake}
        onSleep={handlers.onSleep}
        isActionPending={opts.isActionPending ?? false}
        isRestarting={opts.isRestarting ?? false}
        isDeleting={opts.isDeleting ?? false}
      />
    </TooltipProvider>,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  clearToolCallLedger();
});

describe('WorkerCard', () => {
  it('shows the header with runtime badge and health ring', () => {
    renderCard(makeWorker());
    expect(screen.getByText('worker-a')).toBeInTheDocument();
    expect(screen.getAllByText('QwenPaw').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
  });

  it('fills the vitals strip with 暂无 when backend fields are missing', () => {
    renderCard(makeWorker({ message: '' }));
    const strip = screen.getByTestId('vitals-strip');
    expect(strip).toHaveTextContent('最近任务');
    expect(strip).toHaveTextContent('持续时长');
    expect(strip).toHaveTextContent('最近活动');
    expect(strip).toHaveTextContent('工具调用');
    expect(strip.textContent?.match(/暂无/g)).toHaveLength(4);
  });

  it('shows task, duration, activity and tool-call count when data exists', () => {
    const now = Date.now();
    recordToolCalls('worker-a', '$evt1', 3, now);
    renderCard(
      makeWorker({
        lastTaskSummary: '处理工单 #4821',
        stateStartedAt: new Date(now - 12 * 60_000).toISOString(),
        lastActivityAt: new Date(now - 5 * 60_000).toISOString(),
      }),
    );
    const strip = screen.getByTestId('vitals-strip');
    expect(strip).toHaveTextContent('处理工单 #4821');
    expect(strip).toHaveTextContent('12 分钟');
    expect(strip).toHaveTextContent('5 分钟前');
    expect(strip).toHaveTextContent('3 次');
  });

  it('keeps exactly the checkbox + 详情 / 重启 / 休眠 actions', () => {
    renderCard(makeWorker());
    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['', '详情', '重启', '休眠']);
    expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开聊天/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ensure Ready/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /升级/ })).not.toBeInTheDocument();
  });

  it('shows 唤醒 for Sleeping / Stopped workers', () => {
    renderCard(makeWorker({ phase: 'Sleeping', state: 'Sleeping' }));
    expect(screen.getByRole('button', { name: /唤醒/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /休眠/ })).not.toBeInTheDocument();
  });

  it('disables the sleep button for Pending workers', () => {
    renderCard(makeWorker({ phase: 'Pending', state: 'Stopped' }));
    expect(screen.getByRole('button', { name: /休眠/ })).toBeDisabled();
  });

  it('opens the drawer when the card body is clicked', () => {
    const handlers = renderCard(makeWorker());
    fireEvent.click(screen.getByTestId('worker-card'));
    expect(handlers.onOpenDrawer).toHaveBeenCalledTimes(1);
  });

  it('opens the drawer with Enter / Space for keyboard users', () => {
    const handlers = renderCard(makeWorker());
    const card = screen.getByTestId('worker-card');
    expect(card).toHaveAttribute('aria-label', '打开 worker-a 详情面板');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(handlers.onOpenDrawer).toHaveBeenCalledTimes(2);
  });

  it('does not bubble clicks from the checkbox or action buttons', () => {
    const handlers = renderCard(makeWorker());
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    fireEvent.click(screen.getByRole('button', { name: '重启' }));
    fireEvent.click(screen.getByRole('button', { name: '休眠' }));
    expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onView).toHaveBeenCalledTimes(1);
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
    expect(handlers.onSleep).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenDrawer).not.toHaveBeenCalled();
  });

  it('calls wake for sleeping workers and sleep for running workers', () => {
    const sleeping = renderCard(makeWorker({ phase: 'Sleeping', state: 'Sleeping' }));
    fireEvent.click(screen.getByRole('button', { name: /唤醒/ }));
    expect(sleeping.onWake).toHaveBeenCalledTimes(1);
    cleanup();
    const running = renderCard(makeWorker());
    fireEvent.click(screen.getByRole('button', { name: /休眠/ }));
    expect(running.onSleep).toHaveBeenCalledTimes(1);
  });

  it('narrates Running as 正在帮 {team} 处理 {task}', () => {
    renderCard(makeWorker({ lastTaskSummary: '处理工单 #4821' }));
    expect(screen.getByTestId('status-narrative')).toHaveTextContent('正在帮 team-alpha 处理 处理工单 #4821');
  });

  it('renders the deleting overlay and blocks interaction', () => {
    renderCard(makeWorker(), { isDeleting: true });
    expect(screen.getByTestId('deleting-overlay')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('删除中，等待 Controller 完成任务');
    expect(screen.getByRole('button', { name: '选择' })).toBeDisabled();
  });

  it('uses tier wording instead of a bare health score', () => {
    renderCard(makeWorker());
    expect(document.body.textContent).not.toMatch(/健康评分/);
    expect(screen.getByLabelText(/稳定运行/)).toBeInTheDocument();
  });
});
