import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ManagerResponse, TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';

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

const managersFixture = [
  {
    name: 'boss',
    phase: 'Active',
    state: 'Running',
    runtime: 'qwenpaw',
    model: 'boss-model',
    image: 'img:latest',
    matrixUserID: '@boss:server',
    roomID: '!boss:server',
    message: '',
  },
] as unknown as ManagerResponse[];

// 可变 mock 状态：权限 / 搜索 / 模型目录场景在同一套件里切换。
const mockState = vi.hoisted(() => ({
  searchQuery: '',
  userLevel: 3,
  modelOptions: [] as ModelSelectionOption[],
}));
const refetchTeams = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-agentteams-teams', () => ({
  useTeams: () => ({
    data: teamsFixture,
    isLoading: false,
    isError: false,
    refetch: refetchTeams,
    isRefetching: false,
  }),
}));
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: workersFixture }),
}));
vi.mock('@/hooks/use-agentteams-managers', () => ({
  useManagers: () => ({ data: managersFixture }),
}));
vi.mock('@/hooks/use-model-selection', () => ({
  useModelSelection: () => ({
    options: mockState.modelOptions,
    providers: [],
    aiRoutes: [],
    isLoading: false,
    sessionIssue: null,
  }),
}));
vi.mock('@/hooks/use-agentteams-mutations', () => {
  const hook = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => null),
    isPending: false,
  });
  return {
    useCreateTeam: hook,
    useCreateWorker: hook,
    useUpdateTeam: hook,
    useDeleteTeam: hook,
    useUpdateWorker: hook,
    useDeleteWorker: hook,
    useWakeWorker: hook,
    useSleepWorker: hook,
    useEnsureReadyWorker: hook,
    useUpdateManager: hook,
  };
});
vi.mock('@/lib/search-context', () => ({
  useSearch: () => ({ searchQuery: mockState.searchQuery, setSearchQuery: vi.fn() }),
}));
vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: () => ({ isConnected: true, userLevel: mockState.userLevel }),
}));
vi.mock('../teams/team-create-dialog', () => ({
  TeamCreateDialog: ({ open }: { open: boolean }) => (open ? <div>team-create-dialog</div> : null),
}));
vi.mock('../workers/worker-create-dialog', () => ({
  WorkerCreateDialog: ({ open }: { open: boolean }) =>
    open ? <div>worker-create-dialog</div> : null,
}));
vi.mock('../teams/millforge/millforge-dialog', () => ({
  MillforgeDialog: ({
    open,
    team,
    workers,
    onOpenChange,
    onInjected,
  }: {
    open: boolean;
    team: { name: string };
    workers: unknown[];
    onOpenChange: (_open: boolean) => void;
    onInjected?: () => void;
  }) =>
    open ? (
      <div>
        <div data-testid="mock-millforge-dialog">
          millforge-dialog:{team.name}:workers-{workers.length}
        </div>
        <button type="button" onClick={onInjected}>
          mock-injected
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          mock-millforge-close
        </button>
      </div>
    ) : null,
}));

import { TeamAgentsSection } from './team-agents-section';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/hooks/use-agentteams-humans', () => ({
  useHumans: () => ({ data: [
    { name: 'boss', displayName: '团队管理员', permissionLevel: 1, accessibleTeams: ['alpha'] },
    { name: 'reviewer', displayName: '评审成员', permissionLevel: 2, accessibleTeams: ['alpha'] },
  ] }),
}));
vi.mock('../teams/team-settings-panel', () => ({
  TeamSettingsPanel: ({ team }: { team: TeamResponse }) => <div>team-profile:{team.name}</div>,
}));
vi.mock('../workers/worker-detail-panel', () => ({
  WorkerDetailPanel: ({ worker }: { worker: WorkerResponse }) => <div>agent-profile:{worker.name}</div>,
}));
vi.mock('../managers/manager-detail-panel', () => ({
  ManagerDetailPanel: ({ manager }: { manager: ManagerResponse }) => <div>manager-profile:{manager.name}</div>,
}));

function renderSection(hash = '#console/resources/team-agents?tab=teams') {
  window.history.replaceState({}, '', hash);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider><TeamAgentsSection /></TooltipProvider></QueryClientProvider>);
}
function selectTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}
beforeEach(() => { mockState.searchQuery = ''; mockState.userLevel = 3; });
afterEach(cleanup);

describe('Team and Agent resource cards', () => {
  it('keeps large member lists collapsed and opens hidden Agent details from the overflow list', async () => {
    const extra = Array.from({ length: 30 }, (_, index) => worker(`extra-${index}`, 'alpha'));
    const originalNames = teamsFixture[0].workerNames;
    const originalMembers = teamsFixture[0].humanMembers;
    workersFixture.push(...extra);
    teamsFixture[0].workerNames = [...originalNames, ...extra.map((item) => item.name)];
    teamsFixture[0].humanMembers = Array.from({ length: 30 }, (_, index) => `member-${index}`);
    try {
      renderSection();
      expect(screen.queryByRole('button', { name: '查看 extra-29 的主页' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '查看 member-29 的主页' })).not.toBeInTheDocument();
      fireEvent.mouseEnter(screen.getByRole('button', { name: '展开Alpha的 Workers' }));
      const list = await screen.findByRole('dialog', { name: 'Alpha的 Workers 资料卡' });
      expect(within(list).getByRole('heading', { name: 'Workers · 31' })).toBeInTheDocument();
      fireEvent.focus(screen.getByRole('button', { name: '展开Alpha的 Workers' }));
      fireEvent.click(screen.getByRole('button', { name: '展开Alpha的 Workers' }));
      expect(list).toBeInTheDocument();
      fireEvent.click(within(list).getByRole('button', { name: '查看 extra-29 的主页' }));
      expect(screen.getByText('agent-profile:extra-29')).toBeInTheDocument();
    } finally {
      workersFixture.splice(-extra.length);
      teamsFixture[0].workerNames = originalNames;
      teamsFixture[0].humanMembers = originalMembers;
    }
  });

  it('opens an interactive Agent card on hover and keeps it open while entering the card', async () => {
    renderSection();
    const member = screen.getByRole('button', { name: '查看 w1 的主页' });
    fireEvent.mouseEnter(member);
    const preview = await screen.findByRole('dialog', { name: 'w1 资料卡' });
    expect(within(preview).getByText('w1-model')).toBeInTheDocument();
    expect(within(preview).getByText('QwenPaw')).toBeInTheDocument();
    expect(within(preview).getByText('alpha')).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: '编辑' })).toBeInTheDocument();
    fireEvent.mouseLeave(member);
    fireEvent.mouseEnter(preview);
    expect(preview).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole('button', { name: '查看详情' }));
    expect(screen.getByText('agent-profile:w1')).toBeInTheDocument();
  });

  it('shows a human profile card on focus and closes it with Escape', async () => {
    renderSection();
    fireEvent.focus(screen.getByRole('button', { name: '查看 reviewer 的主页' }));
    const preview = await screen.findByRole('dialog', { name: '评审成员 资料卡' });
    expect(within(preview).getByRole('heading', { name: '评审成员' })).toBeInTheDocument();
    expect(within(preview).getByText('团队成员')).toBeInTheDocument();
    fireEvent.keyDown(preview, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('separates humans from agents and excludes the admin and leader from member counts', () => {
    renderSection();
    const cards = screen.getByLabelText('团队卡片');
    expect(within(cards).getAllByText('Team Admin')).toHaveLength(2);
    expect(within(cards).getByText('普通成员 · 1')).toBeInTheDocument();
    expect(within(cards).getByRole('button', { name: '查看 boss 的主页' })).toHaveTextContent('团队管理员');
    expect(within(cards).getByRole('button', { name: '查看 reviewer 的主页' })).toHaveTextContent('评审成员');
    expect(within(cards).getByText('Workers · 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent 卡片')).not.toBeInTheDocument();
  });

  it('shows all agents in their own tab with models and edit controls', () => {
    renderSection();
    selectTab(/^Agent/);
    const cards = screen.getByLabelText('Agent 卡片');
    for (const name of ['lead', 'w1', 'lead2', 'solo', 'boss']) expect(within(cards).getByRole('heading', { name })).toBeInTheDocument();
    expect(within(cards).getByText('w1-model')).toBeInTheDocument();
    expect(within(cards).getAllByRole('button', { name: '编辑' })).toHaveLength(5);
    expect(window.location.hash).toContain('tab=agents');
  });

  it('opens the clicked member homepage and restores the Agent list', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '查看 w1 的主页' }));
    expect(screen.getByText('agent-profile:w1')).toBeInTheDocument();
    expect(window.location.hash).toContain('agent=w1');
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(screen.getByLabelText('Agent 卡片')).toBeInTheDocument();
  });

  it('preserves a direct profile link on refresh and responds to browser navigation', async () => {
    renderSection('#console/resources/team-agents?tab=agents&agent=solo&edit=true');
    expect(screen.getByRole('heading', { name: '编辑 · solo' })).toBeInTheDocument();
    expect(screen.getByText('agent-profile:solo')).toBeInTheDocument();
    window.history.replaceState({}, '', '#console/resources/team-agents?tab=teams&team=beta');
    fireEvent(window, new Event('hashchange'));
    await waitFor(() => expect(screen.getByText('team-profile:beta')).toBeInTheDocument());
  });

  it('links human chips to the user profile and keeps list search usable', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '查看 reviewer 的主页' }));
    expect(window.location.hash).toContain('human=reviewer');
  });

  it('opens the team settings and retains the team configuration tool', () => {
    renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: '编辑团队' })[0]);
    expect(screen.getByText('team-profile:alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '千锻 · 团队配置' }));
    expect(screen.getByTestId('mock-millforge-dialog')).toHaveTextContent('millforge-dialog:alpha');
  });

  it('supports legacy Agent links and searches model names', () => {
    renderSection('#console/resources/workers');
    fireEvent.change(screen.getByLabelText('搜索团队或 Agent'), { target: { value: 'solo-model' } });
    expect(screen.getByRole('heading', { name: 'solo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'w1' })).not.toBeInTheDocument();
  });
});
