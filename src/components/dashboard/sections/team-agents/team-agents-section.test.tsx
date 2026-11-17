import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
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
vi.mock('@/hooks/use-agentteams-humans', () => ({
  useHumans: () => ({
    data: [
      { name: 'boss', displayName: '团队管理员', permissionLevel: 1, accessibleTeams: ['alpha'] },
      { name: 'reviewer', displayName: '评审成员', permissionLevel: 2, accessibleTeams: ['alpha'] },
    ],
  }),
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

// 三个详情面板不 mock：R2 要求弹窗承载当前 main 版真实面板。
import { AgentsSection, TeamAgentsSection, TeamsSection } from './team-agents-section';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash },
  });
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSection(client: QueryClient = makeClient()) {
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TeamAgentsSection />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function shell() {
  return screen.getByTestId('team-agents-shell');
}

function listRegion() {
  return screen.getByRole('region', { name: '团队列表' });
}

function topologyHeader() {
  return screen.getByTestId('team-topology-header');
}

/** 当前打开的详情大弹窗（同时只有一个）。 */
function detailDialog(name?: string | RegExp) {
  if (name) return screen.getByRole('dialog', { name });
  return screen.getByRole('dialog');
}

async function layoutIs(layout: string) {
  await waitFor(() =>
    expect(screen.getByTestId('team-agents-section')).toHaveAttribute('data-layout', layout),
  );
}

/** 列表区域内找含指定文本的按钮并点击（团队行 / Manager 行 / 独立 Worker 行）。 */
function clickListButton(region: HTMLElement, text: string) {
  const button = Array.from(region.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`list button containing ${text} not found`);
  fireEvent.click(button);
}

/** 展开「未归属团队的 Worker」折叠行。 */
async function openStandaloneRow() {
  const region = listRegion();
  fireEvent.click(within(region).getByText(/未归属团队的 Worker/));
  await waitFor(() => expect(within(region).getByText('solo')).toBeInTheDocument());
  return region;
}

/** 点拓扑成员行（div[role=button]，data-worker-name）。 */
function clickTopologyMember(name: string) {
  const node = document.querySelector(`[data-worker-name="${name}"]`);
  if (!node) throw new Error(`topology member ${name} not found`);
  fireEvent.click(node);
}

/** 点拓扑头部显式「团队设置」按钮打开团队设置大弹窗。 */
async function openTeamSettingsDialog() {
  fireEvent.click(screen.getByRole('button', { name: '打开团队设置' }));
  return screen.findByRole('dialog', { name: '团队设置 · alpha' });
}

beforeEach(() => {
  setWidth(1500);
  setHash('');
  mockState.searchQuery = '';
  mockState.userLevel = 3;
  mockState.modelOptions = [];
});

afterEach(cleanup);

describe('TeamAgentsSection · 工作台壳（列表 + 拓扑，无详情栏）', () => {
  it('xwide renders list + topology in two columns, with no detail column', async () => {
    renderSection();
    await layoutIs('xwide');
    const list = listRegion();
    // 统一列表：Manager 行 + 团队行 + 未归属折叠行同在一个列表。
    expect(within(list).getByText('boss')).toBeInTheDocument();
    expect(within(list).getByText('alpha')).toBeInTheDocument();
    expect(within(list).getByText(/未归属团队的 Worker/)).toBeInTheDocument();
    expect(topologyHeader()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '详情' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(shell().children).toHaveLength(2);
    expect(shell().className).toContain('minmax(0,1fr)');
  });

  it.each([
    [1300, 'wide'],
    [1100, 'medium'],
  ])('%s renders list + topology in two columns', async (width, layout) => {
    setWidth(width);
    renderSection();
    await layoutIs(layout);
    expect(listRegion()).toBeInTheDocument();
    expect(topologyHeader()).toBeInTheDocument();
    expect(shell().children).toHaveLength(2);
  });

  it('narrow starts on the list only, with no topology underneath', async () => {
    setWidth(900);
    renderSection();
    await layoutIs('narrow');
    expect(listRegion()).toBeInTheDocument();
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
    expect(shell().children).toHaveLength(1);
  });

  it('narrow team selection swaps to the topology view; back returns to the list', async () => {
    setWidth(900);
    renderSection();
    await layoutIs('narrow');

    clickListButton(listRegion(), 'alpha');
    expect(topologyHeader()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '团队列表' })).toBeNull();
    expect(shell().children).toHaveLength(1);

    const back = screen.getByRole('button', { name: '团队列表' });
    expect(back).toHaveClass('min-h-11');
    fireEvent.click(back);

    await waitFor(() => expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument());
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
    expect(shell().children).toHaveLength(1);
  });

  it('narrow standalone worker selection shows the context card, back returns to the list', async () => {
    setWidth(900);
    renderSection();
    await layoutIs('narrow');

    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    // 点行先开 Worker 详情弹窗；关掉后落在上下文卡（narrow 拓扑视图）。
    await screen.findByRole('dialog', { name: 'Agent · solo' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText(/该 Worker 未归属任何团队/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '团队列表' })).toBeNull();
    expect(shell().children).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '回团队列表' }));
    await waitFor(() => expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument());
  });

  it('has no team/agent tab UI; managers, teams and standalone workers share one list', async () => {
    renderSection();
    await layoutIs('xwide');
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    const list = listRegion();
    expect(within(list).getByText('boss')).toBeInTheDocument(); // Manager 行
    expect(within(list).getByText('alpha')).toBeInTheDocument(); // 团队行
    expect(within(list).getByText(/未归属团队的 Worker/)).toBeInTheDocument(); // 折叠行
  });
});

describe('TeamAgentsSection · 详情大弹窗（R2）', () => {
  it('team settings opens from the explicit header button as a large dialog with the real panel', async () => {
    renderSection();
    await layoutIs('xwide');

    const dialog = await openTeamSettingsDialog();
    expect(within(dialog).getByText('团队设置 · alpha')).toBeInTheDocument();
    expect(within(dialog).getByText('基本信息')).toBeInTheDocument();
    expect(within(dialog).getByText('保存基本信息')).toBeInTheDocument();
  });

  it('team settings also opens from the gear icon', async () => {
    renderSection();
    await layoutIs('xwide');

    fireEvent.click(screen.getByRole('button', { name: '团队设置' }));
    const dialog = await screen.findByRole('dialog', { name: '团队设置 · alpha' });
    expect(within(dialog).getByText('基本信息')).toBeInTheDocument();
  });

  it('clicking a topology member row opens the worker detail dialog with the real panel', async () => {
    renderSection();
    await layoutIs('xwide');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');

    const dialog = await screen.findByRole('dialog', { name: 'Agent · w1' });
    expect(within(dialog).getByText('Agent · w1')).toBeInTheDocument();
    expect(within(dialog).getAllByText('w1-model').length).toBeGreaterThan(0);
  });

  it('clicking a Manager row opens the manager detail dialog with the real panel', async () => {
    renderSection();
    await layoutIs('xwide');

    clickListButton(listRegion(), 'boss');
    const dialog = await screen.findByRole('dialog', { name: 'Manager · boss' });
    expect(within(dialog).getByText('Manager · boss')).toBeInTheDocument();
    expect(within(dialog).getByText('boss')).toBeInTheDocument();
  });

  it('dialog sizing: responsive large classes with a narrow (<640px) variant', async () => {
    renderSection();
    await layoutIs('xwide');

    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');
    const dialog = await screen.findByRole('dialog', { name: 'Agent · w1' });
    expect(dialog.className).toContain('w-[96vw]');
    expect(dialog.className).toContain('max-h-[94vh]');
    expect(dialog.className).toContain('sm:w-[min(1200px,94vw)]');
    expect(dialog.className).toContain('sm:max-h-[88vh]');
    // 内容区独立滚动（body 可滚、外壳裁切）。
    expect(dialog.className).toContain('overflow-hidden');
  });

  it('closes with the header close button and keeps the selection', async () => {
    renderSection();
    await layoutIs('xwide');

    clickListButton(listRegion(), 'alpha');
    await openTeamSettingsDialog();
    const close = detailDialog().querySelector('header button') as HTMLButtonElement;
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // 选中仍在：拓扑继续显示 alpha。
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
  });

  it('closes with Escape', async () => {
    renderSection();
    await layoutIs('xwide');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');

    const dialog = await screen.findByRole('dialog', { name: 'Agent · w1' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('TeamAgentsSection · 拓扑成员高亮', () => {
  it('selecting a topology member highlights the row and keeps it after closing the dialog', async () => {
    renderSection();
    await layoutIs('xwide');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');

    await screen.findByRole('dialog', { name: 'Agent · w1' });
    const row = document.querySelector('[data-worker-name="w1"]');
    expect(row).toHaveAttribute('data-highlighted', 'true');

    fireEvent.keyDown(detailDialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.querySelector('[data-worker-name="w1"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
  });
});

describe('TeamAgentsSection · 未归属 Worker 入口', () => {
  it('expands the standalone row and opens the context card + worker dialog', async () => {
    renderSection();
    await layoutIs('xwide');
    const region = await openStandaloneRow();
    // 行内含会话灯（role=img，aria-label=运行中）→ 可访问名称是「运行中 solo」。
    expect(within(region).getByRole('button', { name: /solo/ })).toBeInTheDocument();

    clickListButton(region, 'solo');
    const dialog = await screen.findByRole('dialog', { name: 'Agent · solo' });
    expect(within(dialog).getAllByText('solo-model').length).toBeGreaterThan(0);
    // 上下文卡在弹窗背后（弹窗打开时背景 inert，用文本断言）。
    expect(screen.getByText(/该 Worker 未归属任何团队/)).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 导航合并兼容导出（R4）', () => {
  it.each(['AgentsSection', 'TeamsSection'] as const)(
    '%s renders the same topology workbench',
    async (name) => {
      const node = name === 'AgentsSection' ? <AgentsSection /> : <TeamsSection />;
      render(
        <QueryClientProvider client={makeClient()}>
          <TooltipProvider>{node}</TooltipProvider>
        </QueryClientProvider>,
      );
      await layoutIs('xwide');
      // SectionHeader(h1) 与列表 PaneHeader(h2) 同名，取 level 1 消歧。
      expect(screen.getByRole('heading', { name: '团队与 Agent', level: 1 })).toBeInTheDocument();
      expect(screen.getByTestId('team-agents-shell')).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.getByTestId('team-topology-header')).toBeInTheDocument();
    },
  );
});

describe('TeamAgentsSection · 旧 hash 深链（初始选中，edit 意图开弹窗）', () => {
  it('legacy workers route preselects the first standalone worker', async () => {
    setHash('#console/resources/workers');
    renderSection();
    await layoutIs('xwide');
    expect(document.querySelector('[role="tab"]')).toBeNull();
    // agents 意图：展开未归属行并选中首个独立 Worker（上下文卡）。
    expect(within(listRegion()).getByText('solo')).toBeInTheDocument();
    // 卡片正文是一整段 p，用正则匹配开头。
    expect(screen.getByText(/该 Worker 未归属任何团队/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('legacy teams route preselects the first team', async () => {
    setHash('#console/resources/teams');
    renderSection();
    await layoutIs('xwide');
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('?team= preselects the named team', async () => {
    setHash('#console/resources/team-agents?team=beta');
    renderSection();
    await layoutIs('xwide');
    expect(screen.getByRole('heading', { name: 'beta' })).toBeInTheDocument();
  });

  it('?team=...&edit=true opens the team settings dialog', async () => {
    setHash('#console/resources/team-agents?team=alpha&edit=true');
    renderSection();
    await layoutIs('xwide');
    const dialog = await screen.findByRole('dialog', { name: '团队设置 · alpha' });
    expect(within(dialog).getByText('基本信息')).toBeInTheDocument();
  });

  it('?agent=...&edit=true opens the worker dialog and expands the standalone row', async () => {
    setHash('#console/resources/team-agents?agent=solo&edit=true');
    renderSection();
    await layoutIs('xwide');
    // 弹窗打开时背景 inert，region 角色查不到；用文本定位折叠行断言展开。
    const toggle = screen.getByText(/未归属团队的 Worker/).closest('button') as HTMLButtonElement;
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const dialog = await screen.findByRole('dialog', { name: 'Agent · solo' });
    expect(within(dialog).getAllByText('solo-model').length).toBeGreaterThan(0);
  });

  it('explicit tab=agents query maps to the agents intent', async () => {
    setHash('#console/resources/team-agents?tab=agents');
    renderSection();
    await layoutIs('xwide');
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(within(listRegion()).getByText('solo')).toBeInTheDocument();
    expect(screen.getByText(/该 Worker 未归属任何团队/)).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 搜索（A3）', () => {
  it('keeps teams with matched members and marks the matched names', async () => {
    mockState.searchQuery = 'w1';
    renderSection();
    await layoutIs('xwide');
    const list = listRegion();
    expect(within(list).getByText('匹配成员：w1')).toBeInTheDocument();
    expect(within(list).queryByText('beta')).toBeNull();
    expect(within(list).getByText('1 / 2')).toBeInTheDocument();
    // 拓扑同步过滤成员行。
    expect(screen.getByText('匹配 1 / 2 名成员')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    mockState.searchQuery = 'zzz-no-match';
    renderSection();
    await layoutIs('xwide');
    expect(within(listRegion()).getByText('没有匹配的团队 / 成员')).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 权限门控（L1，在 Worker 弹窗内）', () => {
  it('hides the worker delete action below L1', async () => {
    mockState.userLevel = 2;
    renderSection();
    await layoutIs('xwide');
    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    const dialog = await screen.findByRole('dialog', { name: 'Agent · solo' });
    expect(within(dialog).queryByRole('button', { name: /删除/ })).toBeNull();
  });

  it('shows the worker delete action at L1', async () => {
    mockState.userLevel = 3;
    renderSection();
    await layoutIs('xwide');
    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    const dialog = await screen.findByRole('dialog', { name: 'Agent · solo' });
    expect(within(dialog).getByRole('button', { name: /删除/ })).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 千锻入口（拓扑承载）', () => {
  it('topology entry card opens the dialog; injected refreshes teams', async () => {
    renderSection();
    await layoutIs('xwide');
    clickListButton(listRegion(), 'alpha');

    const card = screen.getByTestId('millforge-card');
    expect(card).toHaveTextContent('千锻');
    expect(screen.queryByTestId('mock-millforge-dialog')).toBeNull();
    fireEvent.click(card);

    expect(screen.getByTestId('mock-millforge-dialog')).toHaveTextContent(
      'millforge-dialog:alpha:workers-4',
    );
    fireEvent.click(screen.getByRole('button', { name: 'mock-injected' }));
    expect(refetchTeams).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'mock-millforge-close' }));
    expect(screen.queryByTestId('mock-millforge-dialog')).toBeNull();
  });

  it('worker selection keeps the millforge entry on its home team topology', async () => {
    renderSection();
    await layoutIs('xwide');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');

    await screen.findByRole('dialog', { name: 'Agent · w1' });
    expect(screen.getByTestId('millforge-card')).toBeInTheDocument();
    fireEvent.keyDown(detailDialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('millforge-card'));
    expect(screen.getByTestId('mock-millforge-dialog')).toHaveTextContent(
      'millforge-dialog:alpha:workers-4',
    );
  });
});

describe('TeamAgentsSection · 创建入口与团队设置草稿', () => {
  it('keeps create-team and create-agent entries on the page', async () => {
    renderSection();
    await layoutIs('xwide');
    fireEvent.click(screen.getByRole('button', { name: /创建团队/ }));
    expect(screen.getByText('team-create-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /创建 Agent/ }));
    expect(screen.getByText('worker-create-dialog')).toBeInTheDocument();
  });

  it('keeps an unsaved team draft across a model catalog refresh (dialog open)', async () => {
    const client = makeClient();
    const { rerender } = renderSection(client);
    await layoutIs('xwide');

    clickListButton(listRegion(), 'alpha');
    const dialog = await openTeamSettingsDialog();
    const desc = within(dialog).getByLabelText('描述');
    fireEvent.change(desc, { target: { value: '草稿不丢' } });

    // 模型目录刷新（同一 React 树重渲染，catalog 引用变化）——草稿不丢。
    mockState.modelOptions = [{ alias: 'm1', kind: 'configured' }];
    rerender(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <TeamAgentsSection />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(within(detailDialog()).getByLabelText('描述')).toHaveValue('草稿不丢');
  });
});
