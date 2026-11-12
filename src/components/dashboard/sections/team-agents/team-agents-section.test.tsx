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
      <TeamAgentsSection />
    </QueryClientProvider>,
  );
}

function shell() {
  return screen.getByTestId('team-agents-shell');
}

function detailRegion() {
  return screen.getByRole('region', { name: '详情' });
}

function listRegion() {
  return screen.getByRole('region', { name: '团队列表' });
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

beforeEach(() => {
  setWidth(1500);
  setHash('');
  mockState.searchQuery = '';
  mockState.userLevel = 3;
  mockState.modelOptions = [];
});

afterEach(cleanup);

describe('TeamAgentsSection · 四栏壳', () => {
  it('xwide renders list + topology + inline detail (3 content columns)', async () => {
    renderSection();
    await layoutIs('xwide');
    const list = listRegion();
    // 统一列表（F1）：Manager 行 + 团队行 + 未归属折叠行同在一个列表。
    expect(within(list).getByText('boss')).toBeInTheDocument();
    expect(within(list).getByText('alpha')).toBeInTheDocument();
    expect(within(list).getByText(/未归属团队的 Worker/)).toBeInTheDocument();
    expect(screen.getByTestId('team-topology-header')).toBeInTheDocument();
    const detail = detailRegion();
    // 默认选中首个团队 → 内联 TeamSettingsPanel；千锻入口在拓扑（对齐插件）。
    expect(within(detail).getByText('alpha')).toBeInTheDocument();
    expect(within(detail).getByText('基本信息')).toBeInTheDocument();
    expect(within(detail).queryByText('千锻')).toBeNull();
    expect(screen.getByTestId('millforge-card')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: /返回/ })).toBeNull();
    expect(shell().children).toHaveLength(3);
    expect(shell().children[2]).toBe(detail);
    expect(shell().className).toContain('minmax(0,1fr)');
  });

  it('wide renders list + topology with a compact inline detail below it (2 content columns)', async () => {
    setWidth(1300);
    renderSection();
    await layoutIs('wide');
    expect(listRegion()).toBeInTheDocument();
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
    expect(listRegion()).toBeInTheDocument();
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
    expect(listRegion()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '详情' })).toBeNull();
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
    expect(shell().children).toHaveLength(1);
  });

  it('narrow team selection opens a standalone full-height detail page, back returns to the list', async () => {
    setWidth(900);
    renderSection();
    await layoutIs('narrow');

    clickListButton(listRegion(), 'alpha');
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

  it('narrow standalone worker selection enters the detail page, back returns to the list', async () => {
    setWidth(900);
    renderSection();
    await layoutIs('narrow');

    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    const detail = await screen.findByRole('region', { name: '详情' });
    expect(within(detail).getByText('solo')).toBeInTheDocument();
    expect(within(detail).getAllByText('solo-model').length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: '团队列表' })).toBeNull();
    expect(shell().children).toHaveLength(1);

    fireEvent.click(within(detail).getByRole('button', { name: /返回/ }));
    await waitFor(() => expect(screen.getByRole('region', { name: '团队列表' })).toBeInTheDocument());
  });
});

describe('TeamAgentsSection · 统一列表（无分区 tab）', () => {
  it('has no team/agent tab UI; managers, teams and standalone workers share one list', async () => {
    renderSection();
    await layoutIs('xwide');
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    const list = listRegion();
    expect(within(list).getByText('boss')).toBeInTheDocument(); // Manager 行
    expect(within(list).getByText('alpha')).toBeInTheDocument(); // 团队行
    expect(within(list).getByText(/未归属团队的 Worker/)).toBeInTheDocument(); // 折叠行
    expect(screen.queryByRole('region', { name: 'Agent 列表' })).toBeNull();
  });
});

describe('TeamAgentsSection · 旧 hash 深链（只负责初始选中）', () => {
  it('legacy workers route preselects the first standalone worker', async () => {
    setHash('#console/resources/workers');
    renderSection();
    await layoutIs('xwide');
    // agents 意图：展开未归属行并选中首个独立 Worker（无 tab UI）。
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(within(detailRegion()).getByText('solo')).toBeInTheDocument();
    // 头部与模型卡都会显示模型名 → 断言至少出现一处。
    expect(within(detailRegion()).getAllByText('solo-model').length).toBeGreaterThan(0);
  });

  it('legacy teams route preselects the first team', async () => {
    setHash('#console/resources/teams');
    renderSection();
    await layoutIs('xwide');
    expect(within(detailRegion()).getByText('alpha')).toBeInTheDocument();
    expect(within(detailRegion()).getByText('基本信息')).toBeInTheDocument();
  });

  it('explicit tab=agents query maps to the agents intent', async () => {
    setHash('#console/resources/team-agents?tab=agents');
    renderSection();
    await layoutIs('xwide');
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(within(detailRegion()).getByText('solo')).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 内联详情（不再使用抽屉）', () => {
  it('shows the selected standalone worker inline instead of opening a drawer', async () => {
    renderSection();
    await layoutIs('xwide');
    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    await waitFor(() => expect(within(detailRegion()).getByText('solo')).toBeInTheDocument());
    // 头部与模型卡都会显示模型名 → 断言至少出现一处。
    expect(within(detailRegion()).getAllByText('solo-model').length).toBeGreaterThan(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the selected team settings inline (no millforge card, no dialog)', async () => {
    renderSection();
    await layoutIs('xwide');
    clickListButton(listRegion(), 'alpha');

    const detail = detailRegion();
    expect(within(detail).getByText('alpha')).toBeInTheDocument();
    expect(within(detail).getByText('基本信息')).toBeInTheDocument();
    expect(within(detail).queryByText('千锻')).toBeNull();
    expect(within(detail).getByText('加入未归属 Worker')).toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('team topology hosts the millforge entry: click opens the dialog, injected refreshes', async () => {
    renderSection();
    await layoutIs('xwide');
    // 默认已选中 alpha；显式再点一次团队行，避免依赖初始选择时序。
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

    await waitFor(() => expect(within(detailRegion()).getByText('w1')).toBeInTheDocument());
    expect(screen.getByTestId('millforge-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('millforge-card'));
    expect(screen.getByTestId('mock-millforge-dialog')).toHaveTextContent(
      'millforge-dialog:alpha:workers-4',
    );
  });

  it.each([
    [1300, 'wide'],
    [1100, 'medium'],
  ])('keeps a selected member worker in an inline detail at width %i', async (width, layout) => {
    setWidth(width);
    renderSection();
    await layoutIs(layout);
    clickListButton(listRegion(), 'alpha');
    // 拓扑成员行点击 → 选中该 Worker（内联详情，无抽屉）。
    clickTopologyMember('w1');

    await waitFor(() => expect(within(detailRegion()).getByText('w1')).toBeInTheDocument());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the selected manager inline (ManagerDetailPanel, no dialog)', async () => {
    renderSection();
    await layoutIs('xwide');
    clickListButton(listRegion(), 'boss');

    await waitFor(() => expect(within(detailRegion()).getByText('boss')).toBeInTheDocument());
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

describe('TeamAgentsSection · 搜索（A3）', () => {
  it('keeps teams with matched members and marks the matched names', async () => {
    mockState.searchQuery = 'w1';
    renderSection();
    await layoutIs('xwide');
    const list = listRegion();
    expect(within(list).getByText('匹配成员：w1')).toBeInTheDocument();
    expect(within(list).queryByText('beta')).toBeNull();
    expect(within(list).getByText('1 / 2')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    mockState.searchQuery = 'zzz-no-match';
    renderSection();
    await layoutIs('xwide');
    expect(within(listRegion()).getByText('没有匹配的团队 / 成员')).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 权限门控（L1）', () => {
  it('hides the worker delete action below L1', async () => {
    mockState.userLevel = 2;
    renderSection();
    await layoutIs('xwide');
    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    await waitFor(() => expect(within(detailRegion()).getByText('solo')).toBeInTheDocument());
    expect(within(detailRegion()).queryByRole('button', { name: /删除/ })).toBeNull();
  });

  it('shows the worker delete action at L1', async () => {
    mockState.userLevel = 3;
    renderSection();
    await layoutIs('xwide');
    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    await waitFor(() => expect(within(detailRegion()).getByText('solo')).toBeInTheDocument());
    expect(within(detailRegion()).getByRole('button', { name: /删除/ })).toBeInTheDocument();
  });
});

describe('TeamAgentsSection · 团队设置草稿（C2）', () => {
  it('keeps an unsaved team draft across a model catalog refresh', async () => {
    const client = makeClient();
    const { rerender } = renderSection(client);
    await layoutIs('xwide');
    // 默认选中 alpha；在描述框里写草稿。
    const desc = within(detailRegion()).getByLabelText('描述');
    fireEvent.change(desc, { target: { value: '草稿不丢' } });

    // 模型目录刷新（同一 React 树重渲染，catalog 引用变化）。
    mockState.modelOptions = [{ alias: 'm1', kind: 'configured' }];
    rerender(
      <QueryClientProvider client={client}>
        <TeamAgentsSection />
      </QueryClientProvider>,
    );
    expect(within(detailRegion()).getByLabelText('描述')).toHaveValue('草稿不丢');
  });
});
