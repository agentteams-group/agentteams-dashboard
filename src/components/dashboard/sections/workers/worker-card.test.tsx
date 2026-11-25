import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkerCard } from './worker-card';
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
});

describe('WorkerCard', () => {
  it('shows a single runtime badge and keeps the team visible', () => {
    renderCard(makeWorker());
    expect(screen.getByText('worker-a')).toBeInTheDocument();
    expect(screen.getAllByText('QwenPaw')).toHaveLength(1);
    expect(screen.getByText('team-alpha')).toBeInTheDocument();
  });

  it('keeps secondary actions in the menu', () => {
    const handlers = renderCard(makeWorker());
    expect(screen.queryByRole('button', { name: '重启' })).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'worker-a 更多操作' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: '重启' }));
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenDrawer).not.toHaveBeenCalled();
  });

  it('disables sleep for Pending workers', () => {
    renderCard(makeWorker({ phase: 'Pending', state: 'Stopped' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'worker-a 更多操作' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('menuitem', { name: '休眠' })).toHaveAttribute('data-disabled');
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
    expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onView).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenDrawer).not.toHaveBeenCalled();
  });

  it('calls wake for sleeping workers and sleep for running workers', () => {
    const sleeping = renderCard(makeWorker({ phase: 'Sleeping', state: 'Sleeping' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'worker-a 更多操作' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: '唤醒' }));
    expect(sleeping.onWake).toHaveBeenCalledTimes(1);
    cleanup();
    const running = renderCard(makeWorker());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'worker-a 更多操作' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: '休眠' }));
    expect(running.onSleep).toHaveBeenCalledTimes(1);
  });

  it('shows the actual task summary', () => {
    renderCard(makeWorker({ lastTaskSummary: '处理工单 #4821' }));
    expect(screen.getByText('处理工单 #4821')).toBeInTheDocument();
  });

  it('renders the deleting overlay and blocks interaction', () => {
    renderCard(makeWorker(), { isDeleting: true });
    expect(screen.getByTestId('deleting-overlay')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('删除中，等待 Controller 完成任务');
    expect(screen.getByRole('button', { name: '选择' })).toBeDisabled();
  });

});
