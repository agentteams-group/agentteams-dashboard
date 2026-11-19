import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OverviewSection } from './overview-section';

vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: () => ({ data: [] }) }));
vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: () => ({ data: [] }) }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => ({ data: [{}, {}] }) }));
vi.mock('@/hooks/use-projects', () => ({ useApiTaskBoard: () => ({ tasks: [], isLoading: true, degraded: false }) }));
vi.mock('./workspace-home', () => ({
  WorkspaceHome: ({ workerCount, loading }: { workerCount: number; loading: boolean }) => (
    <main>Workspace home ({workerCount} workers, {loading ? 'loading' : 'loaded'})</main>
  ),
}));

afterEach(cleanup);

it('renders only the workspace home, with the data needed for its summary', () => {
  const { container } = render(<OverviewSection />);
  const home = screen.getByRole('main');
  expect(container.childNodes).toHaveLength(1);
  expect(container.firstChild).toBe(home);
  expect(home.textContent).toBe('Workspace home (2 workers, loading)');
});
