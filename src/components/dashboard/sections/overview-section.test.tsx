import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OverviewSection } from './overview-section';

const board = vi.hoisted(() => ({ tasks: [] as unknown[], isLoading: true, degraded: false }));

vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: () => ({ data: [] }) }));
vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: () => ({ data: [] }) }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => ({ data: [{}, {}] }) }));
vi.mock('@/hooks/use-projects', () => ({ useApiTaskBoard: () => board, useProjects: () => ({ data: { projects: [] } }) }));
vi.mock('./workspace-home', () => ({
  WorkspaceHome: ({ workerCount, loading, degraded, tasks }: { workerCount: number; loading: boolean; degraded: boolean; tasks: unknown[] }) => (
    <main>Workspace home ({workerCount} workers, {loading ? 'loading' : 'loaded'}, {degraded ? 'degraded' : 'healthy'}, {tasks.length} tasks)</main>
  ),
}));

beforeEach(() => {
  board.tasks = [];
  board.isLoading = true;
  board.degraded = false;
});
afterEach(cleanup);

it('renders the workspace home with the data needed for its summary', () => {
  const { container } = render(<OverviewSection />);
  const home = screen.getByRole('main');
  expect(container.firstChild).toBe(home);
  expect(home.textContent).toBe('Workspace home (2 workers, loading, healthy, 0 tasks)');
});

it('forwards the degraded task-board state to the workspace home', () => {
  board.isLoading = false;
  board.degraded = true;
  board.tasks = [{}, {}];
  render(<OverviewSection />);
  expect(screen.getByRole('main').textContent).toBe('Workspace home (2 workers, loaded, degraded, 2 tasks)');
});
