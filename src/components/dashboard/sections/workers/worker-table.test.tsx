import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkerTable } from './worker-table';
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

const noop = () => {};

afterEach(cleanup);

describe('WorkerTable', () => {
  it('opens chat when onOpenChat is supplied and worker has roomID', () => {
    const onOpenChat = vi.fn();
    render(
      <TooltipProvider>
        <WorkerTable
          workers={[makeWorker()]}
          selectedWorkers={new Set()}
          onToggleSelect={noop}
          onView={noop}
          onEdit={noop}
          onOpenChat={onOpenChat}
          onWake={noop}
          onSleep={noop}
          onEnsureReady={noop}
          onDelete={noop}
          isActionPending={false}
          deletingWorkerNames={new Set()}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '打开 worker-a 聊天' }));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it('disables open chat when the worker has no roomID', () => {
    render(
      <TooltipProvider>
        <WorkerTable
          workers={[makeWorker({ roomID: '' })]}
          selectedWorkers={new Set()}
          onToggleSelect={noop}
          onView={noop}
          onEdit={noop}
          onOpenChat={vi.fn()}
          onWake={noop}
          onSleep={noop}
          onEnsureReady={noop}
          onDelete={noop}
          isActionPending={false}
          deletingWorkerNames={new Set()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: '打开 worker-a 聊天' })).toBeDisabled();
  });

  it('shows an upgrade action for leftover CoPaw workers', () => {
    const onUpgradeToQwenPaw = vi.fn();
    render(
      <TooltipProvider>
        <WorkerTable
          workers={[makeWorker({ runtime: 'copaw' })]}
          selectedWorkers={new Set()}
          onToggleSelect={noop}
          onView={noop}
          onEdit={noop}
          onWake={noop}
          onSleep={noop}
          onEnsureReady={noop}
          onUpgradeToQwenPaw={onUpgradeToQwenPaw}
          onDelete={noop}
          isActionPending={false}
          deletingWorkerNames={new Set()}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '升级 worker-a 到 QwenPaw' }));
    expect(onUpgradeToQwenPaw).toHaveBeenCalledTimes(1);
  });
});
