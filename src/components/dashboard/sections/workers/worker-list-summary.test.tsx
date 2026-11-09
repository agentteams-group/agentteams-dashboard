import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkerCard } from './worker-card';
import type { WorkerResponse } from '@/lib/agentteams-api';

afterEach(cleanup);

it('keeps the list focused and does not present controller warnings as tasks', () => {
  const worker = {
    name: 'worker-a', phase: 'Running', state: 'Running', runtime: 'qwenpaw',
    model: 'model-detail-only', team: 'team-alpha', message: 'Skill assignment warning: missing skill',
  } as WorkerResponse;
  render(<TooltipProvider><WorkerCard worker={worker} index={0} isSelected={false}
    onToggleSelect={vi.fn()} onView={vi.fn()} onOpenDrawer={vi.fn()} onRestart={vi.fn()}
    onWake={vi.fn()} onSleep={vi.fn()} isActionPending={false} isDeleting={false}
  /></TooltipProvider>);
  expect(screen.getByText('team-alpha')).toBeInTheDocument();
  expect(screen.getAllByText('QwenPaw')).toHaveLength(1);
  expect(screen.queryByTestId('vitals-strip')).not.toBeInTheDocument();
  expect(screen.queryByTestId('runtime-feature')).not.toBeInTheDocument();
  expect(screen.queryByText('model-detail-only')).not.toBeInTheDocument();
  expect(screen.queryByText(/正在帮/)).not.toBeInTheDocument();
  expect(screen.getByText('有运行提示，查看详情')).toBeInTheDocument();
});
