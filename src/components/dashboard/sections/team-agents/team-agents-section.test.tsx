import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

const teamsFixture = [
  {
    name: 'alpha',
    teamName: 'Alpha',
    phase: 'Active',
    description: '',
    admin: { name: 'boss' },
    humanMembers: [],
    leaderName: 'lead',
    leaderHeartbeat: null,
    workerIdleTimeout: '720m',
    teamRoomID: '!team:server',
    leaderDMRoomID: '!dm:server',
    leaderReady: true,
    readyWorkers: 2,
    totalWorkers: 2,
    message: '',
    workerNames: ['lead', 'w1'],
    workerExposedPorts: {},
  },
  {
    name: 'beta',
    teamName: 'Beta',
    phase: 'Active',
    description: '',
    admin: null,
    humanMembers: [],
    leaderName: 'lead2',
    leaderHeartbeat: null,
    workerIdleTimeout: '720m',
    teamRoomID: '!team2:server',
    leaderDMRoomID: '!dm2:server',
    leaderReady: true,
    readyWorkers: 1,
    totalWorkers: 1,
    message: '',
    workerNames: ['lead2'],
    workerExposedPorts: {},
  },
] as unknown as TeamResponse[];

function worker(name: string, team: string): WorkerResponse {
  return {
    name,
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: `${name}-model`,
    runtime: 'qwenpaw',
    image: 'img:latest',
    containerState: 'running',
    matrixUserID: `@${name}:server`,
    roomID: `!${name}:server`,
    message: '',
    team,
    role: 'worker',
  } as unknown as WorkerResponse;
}

const workersFixture = [
  worker('lead', 'alpha'),
  worker('w1', 'alpha'),
  worker('lead2', 'beta'),
  worker('solo', ''),
];

vi.mock('@/hooks/use-agentteams-teams', () => ({
  useTeams: () => ({
    data: teamsFixture,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    isRefetching: false,
  }),
}));
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: workersFixture }),
}));
vi.mock('@/hooks/use-model-selection', () => ({
  useModelSelection: () => ({ options: [], providers: [], aiRoutes: [], isLoading: false, sessionIssue: null }),
}));
vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useCreateTeam: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateWorker: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/search-context', () => ({
  useSearch: () => ({ searchQuery: '', setSearchQuery: vi.fn() }),
}));
vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: () => ({ isConnected: true, userLevel: 3 }),
}));
vi.mock('../teams/team-create-dialog', () => ({
  TeamCreateDialog: ({ open }: { open: boolean }) => (open ? <div>team-create-dialog</div> : null),
}));
vi.mock('../workers/worker-create-dialog', () => ({
  WorkerCreateDialog: ({ open }: { open: boolean }) =>
    open ? <div>worker-create-dialog</div> : null,
}));

import { TeamAgentsSection } from './team-agents-section';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash },
  });
}

function renderSection(node: ReactNode = <TeamAgentsSection />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function shell() {
  return screen.getByTestId('team-agents-shell');
}

function detailRegion() {
  return screen.getByRole('region', { name: '详情' });
}

async function layoutIs(layout: string) {
  await waitFor(() =>
    expect(screen.getByTestId('team-agents-section')).toHaveAttribute('data-layout', layout),
  );
}

beforeEach(() => {
  setWidth(1500);
  setHash('');
});

afterEach(cleanup);

describe('TeamAgentsSection · 四栏壳', () => {
  it('xwide renders list + topology + inline detail (3 content columns)', async () => {
    renderSection();
    await layoutIs('xwide');
    expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument();
    expect(screen.getByTestId('team-topology-header')).toBeInTheDocument();
    const detail = detailRegion();
    expect(within(detail).getByText('alpha')).toBeInTheDocument();
    expect(within(detail).getByText('Leader')).toBeInTheDocument();
    expect(within(detail).getByText('boss')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: /返回/ })).toBeNull();
    expect(shell().children).toHaveLength(3);
    expect(shell().children[2]).toBe(detail);
    expect(shell().className).toContain('minmax(0,1fr)');
  });

  it('wide renders list + topology with a compact inline detail below it (2 content columns)', async () => {
    setWidth(1300);
    renderSection();
    await layoutIs('wide');
    expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument();
    expect(within(detailRegion()).getByText('alpha')).toBeInTheDocument();
    expect(shell().children).toHaveLength(2);

    const main = shell().children[1] as HTMLElement;
    const topologyHeader = within(main).getByTestId('team-topology-header');
    const inlineDetail = within(main).getByRole('region', { name: '详情' });
    expect(
      topologyHeader.compareDocumentPosition(inlineDetail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('medium renders list + topology with an inline detail below it, not a drawer', async () => {
    setWidth(1100);
    renderSection();
    await layoutIs('medium');
    expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument();
    expect(screen.getByTestId('team-topology-header')).toBeInTheDocument();
    expect(within(detailRegion()).getByText('alpha')).toBeInTheDocument();
    expect(shell().children).toHaveLength(2);

    const main = shell().children[1] as HTMLElement;
    const topologyHeader = within(main).getByTestId('team-topology-header');
    const inlineDetail = within(main).getByRole('region', { name: '详情' });
    expect(
      topologyHeader.compareDocumentPosition(inlineDetail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('narrow starts on the list only, with no topology underneath', async () => {
    setWidth(900);
    renderSection();
    await layoutIs('narrow');
    expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '详情' })).toBeNull();
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
    expect(shell().children).toHaveLength(1);
  });

  it('narrow team selection opens a standalone full-height detail page, back returns to the list', async () => {
    setWidth(900);
    renderSection();
    await layoutIs('narrow');

    fireEvent.click(screen.getByText('alpha').closest('button') as HTMLElement);
    const detail = await screen.findByRole('region', { name: '详情' });
    expect(within(detail).getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '团队列表' })).toBeNull();
    // 只有详情：拓扑不再堆在详情下方，详情独占整页高度。
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
    expect(shell().children).toHaveLength(1);
    expect(shell().firstElementChild).toBe(detail);
    expect(detail.className).toContain('h-full');
    expect(detail.className).not.toContain('max-h-[45%]');

    const back = within(detail).getByRole('button', { name: /返回/ });
    expect(back).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:ring-2');
    fireEvent.click(back);

    await waitFor(() => expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: '详情' })).toBeNull();
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
    expect(shell().children).toHaveLength(1);
  });

  it('narrow agent selection also enters the standalone detail page', async () => {
    setWidth(900);
    setHash('#console/resources/team-agents?tab=agents');
    renderSection();
    await layoutIs('narrow');
    const agentList = screen.getByRole('region', { name: 'Agent 列表' });
    fireEvent.click(withinRegion(agentList, 'solo'));

    const detail = await screen.findByRole('region', { name: '详情' });
    expect(within(detail).getByText('solo')).toBeInTheDocument();
    expect(within(detail).getByText('solo-model')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agent 列表' })).toBeNull();
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
    expect(shell().children).toHaveLength(1);
  });
});

describe('TeamAgentsSection · 旧路由/页签', () => {
  it('opens the Agent tab for the legacy workers route', async () => {
    setHash('#console/resources/workers');
    renderSection();
    await layoutIs('xwide');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Agent/ })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('region', { name: 'Agent 列表' })).toBeInTheDocument();
  });

  it('opens the teams tab for the legacy teams route', async () => {
    setHash('#console/resources/teams');
    renderSection();
    await layoutIs('xwide');
    expect(screen.getByRole('tab', { name: /团队/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 内联详情（不再使用抽屉）', () => {
  it('shows the selected Agent inline instead of opening a drawer', async () => {
    setHash('#console/resources/team-agents?tab=agents');
    renderSection();
    await layoutIs('xwide');
    const agentList = screen.getByRole('region', { name: 'Agent 列表' });
    fireEvent.click(withinRegion(agentList, 'solo'));

    await waitFor(() => expect(within(detailRegion()).getByText('solo')).toBeInTheDocument());
    expect(within(detailRegion()).getByText('solo-model')).toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain('worker-drawer');
  });

  it('shows the selected team inline when the list settings button is used', async () => {
    renderSection();
    await layoutIs('xwide');
    fireEvent.click(screen.getByRole('button', { name: '打开 alpha 团队设置' }));

    expect(within(detailRegion()).getByText('alpha')).toBeInTheDocument();
    expect(within(detailRegion()).queryByText(/打开团队设置/)).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain('team-drawer');
  });

  it.each([
    [1300, 'wide'],
    [1100, 'medium'],
  ])('keeps the selected worker in an inline detail at width %i', async (width, layout) => {
    setWidth(width);
    setHash('#console/resources/team-agents?tab=agents');
    renderSection();
    await layoutIs(layout);
    const agentList = screen.getByRole('region', { name: 'Agent 列表' });
    fireEvent.click(withinRegion(agentList, 'w1'));

    await waitFor(() => expect(within(detailRegion()).getByText('w1')).toBeInTheDocument());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps create-team and create-agent entries on the page', async () => {
    renderSection();
    await layoutIs('xwide');
    fireEvent.click(screen.getByRole('button', { name: /创建团队/ }));
    expect(screen.getByText('team-create-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /创建 Agent/ }));
    expect(screen.getByText('worker-create-dialog')).toBeInTheDocument();
  });
});

function withinRegion(region: HTMLElement, text: string): HTMLElement {
  const node = Array.from(region.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );
  if (!node) throw new Error(`button containing ${text} not found`);
  return node;
}
