import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerDetailPanel } from './worker-detail-panel';
import { QueryProvider } from '@/lib/query-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fetchWorkerDetail } from '@/lib/worker-detail';
import type { WorkerResponse } from '@/lib/agentteams-api';

vi.mock('@/lib/worker-detail', () => ({ fetchWorkerDetail: vi.fn(), invalidateWorkerDetail: vi.fn() }));
vi.mock('@/hooks/use-agentteams-worker-skills', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/use-agentteams-worker-skills')>(),
  useWorkerSkills: () => ({ data: [] }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('updates the detail status and runtime when the polled Worker changes', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const running: WorkerResponse = { name: 'worker-1', phase: 'Running', state: 'Running', runtime: 'codex',
    model: 'qwen3.6-plus', containerState: 'running', containerManaged: true, skills: [],
    image: '', matrixUserID: '', roomID: '', message: '', team: '', role: 'worker' };
  const sleeping = { ...running, phase: 'Sleeping', state: 'Sleeping', containerState: 'stopped' } as WorkerResponse;
  const switched = { ...running, runtime: 'qwenpaw' } as WorkerResponse;
  vi.mocked(fetchWorkerDetail).mockResolvedValueOnce(running).mockResolvedValueOnce(sleeping).mockResolvedValueOnce(switched);
  const panel = (worker: WorkerResponse) => <QueryProvider><TooltipProvider>
    <WorkerDetailPanel worker={worker} modelOptions={[]} userLevel={1} />
  </TooltipProvider></QueryProvider>;
  const view = render(panel(running));
  await waitFor(() => expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument());
  await waitFor(() => expect(fetchWorkerDetail).toHaveBeenCalledTimes(1));
  view.rerender(panel(sleeping));
  await waitFor(() => expect(screen.getByRole('img', { name: 'Sleeping' })).toBeInTheDocument());
  view.rerender(panel(switched));
  await waitFor(() => expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument());
  expect(screen.getByTitle('QwenPaw')).toBeInTheDocument();
});
