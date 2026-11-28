import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerDetailPanel } from './worker-detail-panel';
import { QueryProvider } from '@/lib/query-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fetchWorkerDetail } from '@/lib/worker-detail';
import { agentteamsApi, type TeamResponse, type WorkerResponse } from '@/lib/agentteams-api';

vi.mock('@/lib/worker-detail', () => ({ fetchWorkerDetail: vi.fn(), invalidateWorkerDetail: vi.fn() }));
vi.mock('@/hooks/use-agentteams-worker-skills', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/use-agentteams-worker-skills')>(),
  useWorkerSkills: () => ({ data: [] }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('opens the Team Leader conversation instead of the inaccessible Worker personal room', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const worker: WorkerResponse = { name: 'leader', phase: 'Running', state: 'Running', runtime: 'claudecode',
    model: 'test', containerState: 'running', containerManaged: true, skills: [], image: '',
    matrixUserID: '@leader:test', roomID: '!personal:test', message: '', team: 'alpha', role: 'team_leader' };
  vi.mocked(fetchWorkerDetail).mockResolvedValue(worker);
  const team = vi.spyOn(agentteamsApi, 'getTeam').mockResolvedValue({ leaderName: 'leader', leaderDMRoomID: '!leader-dm:test' } as TeamResponse);
  const onDm = vi.fn();
  render(<QueryProvider><TooltipProvider><WorkerDetailPanel worker={worker} modelOptions={[]} userLevel={1} onDm={onDm} /></TooltipProvider></QueryProvider>);
  fireEvent.click(screen.getByRole('button', { name: '私聊' }));
  await waitFor(() => expect(onDm).toHaveBeenCalledWith('@leader:test', '!leader-dm:test'));
  expect(team).toHaveBeenCalledWith('alpha');
  team.mockRestore();
});

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
