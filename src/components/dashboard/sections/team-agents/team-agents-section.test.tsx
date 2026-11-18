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
import type { TeamAgentsTab } from '@/lib/nav-hash';
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

function renderSection(hash = '#console/resources/team-agents?tab=teams', view?: TeamAgentsTab) {
  window.history.replaceState({}, '', hash);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider><TeamAgentsSection view={view} /></TooltipProvider></QueryClientProvider>);
}
function selectTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}
beforeEach(() => { mockState.searchQuery = ''; mockState.userLevel = 3; localStorage.clear(); });
afterEach(cleanup);

describe('Team and Agent resource cards', () => {
  it('shows the independent Agent page without page tabs or Managers', () => {
    renderSection('#console/resources/workers', 'agents');
    expect(screen.getByRole('heading', { name: '智能体' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    const header = screen.getByRole('heading', { name: '智能体' }).closest('[data-slot="section-header"]') as HTMLElement;
    expect(within(header).getByRole('textbox', { name: '搜索团队或智能体' })).toBeInTheDocument();
    expect(screen.queryByText('4 个智能体')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'boss' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'lead' })).toBeInTheDocument();
  });
  it('shows an independent team page and preserves a selected team on refresh', () => {
    renderSection('#console/resources/teams?team=alpha&edit=true', 'teams');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('team-profile:alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(window.location.hash).toBe('#console/resources/teams');
  });
  it('paginates cards and resets the page when searching or switching tabs', () => {
    const scrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const extra = Array.from({ length: 26 }, (_, index) => worker(`paged-${index}`, 'alpha'));
    workersFixture.push(...extra);
    try {
      renderSection('#console/resources/team-agents?tab=agents');
      // 卡片计数用「详情」按钮（每卡一个；组头按钮是团队名，不会混入）。
      const cards = () => within(screen.getByLabelText('智能体卡片')).getAllByRole('button', { name: '详情' });
      expect(cards()).toHaveLength(12);
      fireEvent.click(screen.getByRole('button', { name: '第 3 页' }));
      expect(cards()).toHaveLength(6);
      fireEvent.change(screen.getByRole('textbox', { name: '搜索团队或智能体' }), { target: { value: 'solo' } });
      expect(cards()).toHaveLength(1);
      expect(screen.getByText('共 1 个智能体 · 第 1 / 1 页')).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: '搜索团队或智能体' }), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: '第 2 页' }));
      selectTab(/^团队/);
      selectTab(/^智能体/);
      expect(screen.getByRole('button', { name: '第 1 页' })).toHaveAttribute('aria-current', 'page');
    } finally { workersFixture.splice(-extra.length); HTMLElement.prototype.scrollIntoView = scrollIntoView; }
  });

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
    // 详情 → 只读详情弹窗（WorkerDetailDialog），不再是页内编辑面。
    fireEvent.click(within(preview).getByRole('button', { name: '详情' }));
    const detail = await screen.findByRole('dialog', { name: 'Worker 详情 - w1' });
    expect(within(detail).getByText('容器状态')).toBeInTheDocument();
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
    expect(screen.queryByLabelText('智能体卡片')).not.toBeInTheDocument();
  });

  it('shows all agents in their own tab with models and edit controls', () => {
    renderSection();
    selectTab(/^智能体/);
    const cards = screen.getByLabelText('智能体卡片');
    for (const name of ['lead', 'w1', 'lead2', 'solo']) expect(within(cards).getByRole('heading', { name })).toBeInTheDocument();
    expect(within(cards).queryByRole('heading', { name: 'boss' })).not.toBeInTheDocument();
    expect(within(cards).getByText('w1-model')).toBeInTheDocument();
    expect(within(cards).getAllByRole('button', { name: '编辑' })).toHaveLength(4);
    expect(window.location.hash).toContain('console/resources/workers');
  });

  it('opens the clicked member homepage and restores the Agent list', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '查看 w1 的主页' }));
    expect(screen.getByText('agent-profile:w1')).toBeInTheDocument();
    expect(window.location.hash).toContain('agent=w1');
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(screen.getByLabelText('智能体卡片')).toBeInTheDocument();
  });

  it('preserves a direct profile link on refresh and responds to browser navigation', async () => {
    renderSection('#console/resources/team-agents?tab=agents&agent=solo&edit=true');
    expect(window.location.hash).toContain('edit=true');
    expect(screen.queryByRole('heading', { name: '编辑 · solo' })).toBeNull();
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

  it('opens the team edit dialog and keeps the in-page detail with the team configuration tool', () => {
    renderSection();
    // 编辑 → 团队编辑弹窗（复用 TeamDetailDialog；面板 mock 为 team-profile:*）。
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'alpha · 基本信息' });
    expect(within(dialog).getByText('team-profile:alpha')).toBeInTheDocument();
    // 详情 → 页内只读详情（「详情 · Alpha」）：与编辑弹窗是两个容器。
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
    expect(screen.getByRole('heading', { name: '详情 · Alpha' })).toBeInTheDocument();
    expect(screen.getAllByText('team-profile:alpha')).toHaveLength(2);
    expect(within(dialog).queryByRole('heading', { name: '详情 · Alpha' })).toBeNull();
    // 页内详情保留千锻工具。
    fireEvent.click(screen.getByRole('button', { name: '千锻 · 团队配置' }));
    expect(screen.getByTestId('mock-millforge-dialog')).toHaveTextContent('millforge-dialog:alpha');
  });

  it('supports legacy Agent links and searches model names', () => {
    renderSection('#console/resources/workers');
    fireEvent.change(screen.getByLabelText('搜索团队或智能体'), { target: { value: 'solo-model' } });
    expect(screen.getByRole('heading', { name: 'solo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'w1' })).not.toBeInTheDocument();
  });

  it('renders Agent detail and edit into different containers', async () => {
    renderSection('#console/resources/workers', 'agents');
    // 详情 → 只读详情弹窗（WorkerDetailDialog，标题带 Worker 名）。
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
    const detail = await screen.findByRole('dialog', { name: 'Worker 详情 - lead' });
    expect(within(detail).getByText('容器状态')).toBeInTheDocument();
    expect(within(detail).queryByText('agent-profile:lead')).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Worker 详情 - lead' })).toBeNull());
    // 编辑 → 编辑抽屉（WorkerDrawer，标题固定「Worker 详情」）：不同容器、不同标题。
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    const drawer = await screen.findByRole('dialog', { name: 'Worker 详情' });
    expect(within(drawer).getByText('agent-profile:lead')).toBeInTheDocument();
    expect(within(drawer).queryByText('容器状态')).toBeNull();
  });

  it('groups Agent cards by team, ungrouped last, group header links to team detail', () => {
    renderSection('#console/resources/workers', 'agents');
    const groups = screen.getAllByTestId('agent-team-group');
    // 组序：团队名 zh 排序，无团队永远最后。
    expect(groups.map((group) => group.getAttribute('data-team'))).toEqual(['alpha', 'beta', '']);
    // 归位：alpha 组含 lead/w1；beta 组含 lead2；solo 落入「无团队」组。
    expect(within(groups[0]).getByRole('heading', { level: 2, name: /Alpha\s*·\s*2 个智能体/ })).toBeInTheDocument();
    expect(within(groups[0]).getByRole('heading', { name: 'lead' })).toBeInTheDocument();
    expect(within(groups[0]).getByRole('heading', { name: 'w1' })).toBeInTheDocument();
    expect(within(groups[0]).queryByRole('heading', { name: 'solo' })).toBeNull();
    expect(within(groups[1]).getByRole('heading', { name: 'lead2' })).toBeInTheDocument();
    expect(within(groups[2]).getByRole('heading', { level: 2, name: /无团队\s*·\s*1 个智能体/ })).toBeInTheDocument();
    expect(within(groups[2]).getByRole('heading', { name: 'solo' })).toBeInTheDocument();
    // 组头可点 → 页内团队详情（标题「详情 · Alpha」）。
    fireEvent.click(within(groups[0]).getByRole('button', { name: 'Alpha' }));
    expect(window.location.hash).toContain('team=alpha');
    expect(screen.getByRole('heading', { name: '详情 · Alpha' })).toBeInTheDocument();
  });
});

describe('团队页视图切换（卡片 / 拓扑）', () => {
  function renderTeams(hash = '#console/resources/teams') {
    return renderSection(hash, 'teams');
  }

  it('默认卡片视图：不渲染工作台，分段控件状态正确', () => {
    renderTeams();
    expect(screen.queryByTestId('team-agents-shell')).toBeNull();
    expect(screen.getByLabelText('团队卡片')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '拓扑视图' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('切拓扑：整页工作台 + URL ?view=topology + 偏好写入；同一控件切回卡片列表', () => {
    renderTeams();
    fireEvent.click(screen.getByRole('button', { name: '拓扑视图' }));
    expect(screen.getByTestId('team-agents-shell')).toBeInTheDocument();
    expect(screen.queryByLabelText('团队卡片')).toBeNull();
    expect(window.location.hash).toContain('view=topology');
    expect(localStorage.getItem('teamAgents.view')).toBe('topology');
    // 拓扑视图内保留同一控件，可切回卡片。
    expect(screen.getByRole('button', { name: '拓扑视图' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '卡片视图' }));
    expect(screen.queryByTestId('team-agents-shell')).toBeNull();
    expect(screen.getByLabelText('团队卡片')).toBeInTheDocument();
    expect(window.location.hash).not.toContain('view=');
    expect(window.location.hash).not.toContain('team=');
    expect(localStorage.getItem('teamAgents.view')).toBe('cards');
  });

  it('URL 带 view=topology 时重挂载仍为拓扑（URL 优先，刷新一致）', () => {
    renderTeams();
    fireEvent.click(screen.getByRole('button', { name: '拓扑视图' }));
    expect(window.location.hash).toContain('view=topology');
    cleanup();
    renderTeams('#console/resources/teams?view=topology');
    expect(screen.getByTestId('team-agents-shell')).toBeInTheDocument();
  });

  it('URL 无 view 时回落 localStorage 偏好；非法值忽略', () => {
    localStorage.setItem('teamAgents.view', 'topology');
    renderTeams();
    expect(screen.getByTestId('team-agents-shell')).toBeInTheDocument();
    cleanup();
    localStorage.setItem('teamAgents.view', 'bogus');
    renderTeams();
    expect(screen.queryByTestId('team-agents-shell')).toBeNull();
    expect(screen.getByLabelText('团队卡片')).toBeInTheDocument();
  });

  it('URL 合法 view 优先于 localStorage', () => {
    localStorage.setItem('teamAgents.view', 'cards');
    renderTeams('#console/resources/teams?view=topology');
    expect(screen.getByTestId('team-agents-shell')).toBeInTheDocument();
  });
});

describe('搜索深链：团队页拓扑视图选中实体（只选中、无分区弹窗）', () => {
  // jsdom 无 ResizeObserver → 工作台回落 window.innerWidth：1920 → triple（内联 Inspector）。
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1920 });
  });

  it.each([
    ['team', 'alpha'],
    ['agent', 'w1'],
    ['manager', 'boss'],
  ])('view=topology&%s=<name> → 工作台选中实体，不开分区弹窗（%s）', async (kind, name) => {
    renderSection(`#console/resources/teams?view=topology&${kind}=${name}`, 'teams');
    expect(screen.getByTestId('team-agents-shell')).toBeInTheDocument();
    expect(screen.queryByLabelText('团队卡片')).toBeNull();
    const inspector = await screen.findByRole('region', { name: '实体详情' });
    expect(await within(inspector).findByRole('heading', { name })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
