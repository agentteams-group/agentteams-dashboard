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

// 可变 mock 状态：权限 / 搜索 / 模型目录 / 团队数据场景在同一套件里切换。
const mockState = vi.hoisted(() => ({
  searchQuery: '',
  userLevel: 3,
  modelOptions: [] as ModelSelectionOption[],
  teams: [] as TeamResponse[],
}));
mockState.teams = teamsFixture;
const refetchTeams = vi.hoisted(() => vi.fn());

// A2：jsdom 没有 ResizeObserver → mock：observe() 立即以挂起宽度回调，
// setWidth() 向所有存活实例广播新宽度（模拟容器尺寸变化）。
const roState = vi.hoisted(() => ({
  width: 1920,
  instances: [] as Array<{
    callback: (_entries: Array<{ contentRect: { width: number } }>) => void;
  }>,
}));
class MockResizeObserver {
  callback: (_entries: Array<{ contentRect: { width: number } }>) => void;
  constructor(callback: (_entries: Array<{ contentRect: { width: number } }>) => void) {
    this.callback = callback;
    roState.instances.push(this);
  }
  observe() {
    this.callback([{ contentRect: { width: roState.width } }]);
  }
  unobserve() {}
  disconnect() {
    const i = roState.instances.indexOf(this);
    if (i !== -1) roState.instances.splice(i, 1);
  }
}

vi.mock('@/hooks/use-agentteams-teams', () => ({
  useTeams: () => ({
    data: mockState.teams,
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
import { TeamAgentsWorkbench } from './team-agents-workbench';

/** 容器宽度 = ResizeObserver 广播宽度（同步 window.innerWidth 兜底路径）。 */
function setWidth(width: number) {
  roState.width = width;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  for (const instance of roState.instances) {
    instance.callback([{ contentRect: { width } }]);
  }
}

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash },
  });
}

/** 模拟外部导航（前进 / 后退 / 跨组件深链）：换 hash + 触发 hashchange。 */
function navigateHash(hash: string) {
  setHash(hash);
  window.dispatchEvent(new Event('hashchange'));
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSection(client: QueryClient = makeClient()) {
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TeamAgentsWorkbench />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function shell() {
  return screen.getByTestId('team-agents-shell');
}

/** 壳的栅格子列（dual 的 Sheet 抽屉 portal 到 body，不占栅格列）。 */
function gridColumns() {
  return Array.from(shell().children);
}

function listRegion() {
  return screen.getByRole('region', { name: '团队列表' });
}

function inspectorRegion() {
  return screen.getByRole('region', { name: '实体详情' });
}

function topologyHeader() {
  return screen.getByTestId('team-topology-header');
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

/** 展开「智能体」折叠行。 */
async function openStandaloneRow() {
  const region = listRegion();
  fireEvent.click(within(region).getByText(/智能体（/));
  await waitFor(() => expect(within(region).getByText('solo')).toBeInTheDocument());
  return region;
}

/** 点拓扑成员行（div[role=button]，data-worker-name）。 */
function clickTopologyMember(name: string) {
  const node = document.querySelector(`[data-worker-name="${name}"]`);
  if (!node) throw new Error(`topology member ${name} not found`);
  fireEvent.click(node);
}

/**
 * 经 Inspector「基本信息」分区按钮打开团队大弹窗（落在基本信息分区）。
 * 齿轮语义修正后多栏不再弹窗（按布局分派），分区直达路径不变。
 */
/** R3：Sheet 遮罩（portal 到 body，不在壳内）。 */
function drawerBackdrop(): HTMLElement | null {
  return document.querySelector('[data-slot="sheet-overlay"]');
}

beforeEach(() => {
  roState.instances = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  setWidth(1920);
  setHash('');
  mockState.searchQuery = '';
  mockState.userLevel = 3;
  mockState.modelOptions = [];
  mockState.teams = teamsFixture;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TeamAgentsWorkbench · A2 断点矩阵（容器宽度 ResizeObserver）', () => {
  it.each([
    [1920, 'triple', 3, 'grid-cols-[320px'],
    [1440, 'triple-compact', 3, 'grid-cols-[280px'],
    [1024, 'dual', 2, 'grid-cols-[300px'],
    [768, 'single', 1, 'grid-cols-1'],
    [390, 'single', 1, 'grid-cols-1'],
  ])('容器宽 %i → %s（栅格 %i 列 / %s）', async (width, layout, columns, gridFragment) => {
    setWidth(width);
    renderSection();
    await layoutIs(layout);
    expect(shell().className).toContain(gridFragment);
    expect(gridColumns()).toHaveLength(columns === 3 ? 2 : columns);
    expect(listRegion()).toBeInTheDocument();
    if (layout === 'single') {
      // 单栏：列表钻取视图（拓扑在选中后才出现）。
      expect(screen.queryByTestId('team-topology-header')).toBeNull();
    } else {
      expect(topologyHeader()).toBeInTheDocument();
    }
    if (layout === 'triple' || layout === 'triple-compact') {
      expect(screen.queryByRole('region', { name: '实体详情' })).toBeNull();
      expect(topologyHeader().closest('[data-testid="team-agents-shell"]')).toBeInTheDocument();
    } else if (layout === 'dual') {
      // dual 的 Inspector 是右侧真 Sheet 抽屉（portal 到 body，不占栅格列），
      // 初始团队只展示中栏，详情由齿轮明确打开。
      expect(screen.queryByRole('region', { name: '实体详情' })).toBeNull();
      expect(screen.queryByTestId('inspector-drawer')).toBeNull();
      expect(drawerBackdrop()).toBeNull();
    }
  });
});

describe('TeamAgentsWorkbench · A2 dual 真 Sheet 抽屉（R3）', () => {
  it('Agent 抽屉只保留一个关闭按钮，点击后保留选中', async () => {
    setWidth(1024); renderSection(); await layoutIs('dual'); clickTopologyMember('w1'); const drawer = await screen.findByTestId('inspector-drawer'); expect(drawer.querySelectorAll('[data-slot="sheet-close"]')).toHaveLength(0); expect(within(drawer).getAllByRole('button', { name: '关闭 Inspector' })).toHaveLength(1); fireEvent.click(within(drawer).getByRole('button', { name: '关闭 Inspector' })); await waitFor(() => expect(screen.queryByTestId('inspector-drawer')).toBeNull()); expect(document.querySelector('[data-worker-name="w1"]')).toHaveAttribute('data-highlighted', 'true');
  });

  it('切换团队关闭 Agent 抽屉，只更新中间团队展示', async () => {
    setWidth(1024); renderSection(); await layoutIs('dual'); clickTopologyMember('w1'); await screen.findByTestId('inspector-drawer'); clickListButton(listRegion(), 'beta'); await waitFor(() => expect(screen.queryByTestId('inspector-drawer')).toBeNull()); expect(within(topologyHeader()).getByRole('heading', { name: 'Beta' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('鼠标悬停预览团队，不打开抽屉；键盘焦点不改变预览', async () => {
    setWidth(1024);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    renderSection();
    await layoutIs('dual');
    const beta = within(listRegion()).getByText('beta').closest('button')!;
    fireEvent.pointerEnter(beta, { pointerType: 'mouse' });
    await waitFor(() => expect(within(topologyHeader()).getByRole('heading', { name: 'Beta' })).toBeInTheDocument());
    expect(screen.queryByTestId('inspector-drawer')).toBeNull();
    const alpha = within(listRegion()).getByText('alpha').closest('button')!;
    fireEvent.focus(alpha);
    expect(within(topologyHeader()).getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    fireEvent.click(alpha);
    expect(within(topologyHeader()).getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByTestId('inspector-drawer')).toBeNull();
  });

  it('成员管理在中栏直接展开，不打开抽屉或弹窗', async () => {
    setWidth(1024); renderSection(); await layoutIs('dual'); fireEvent.click(screen.getByRole('button', { name: '管理成员' })); expect(screen.getByLabelText('Team Admin')).toBeInTheDocument(); expect(screen.getByRole('combobox', { name: '添加用户' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByTestId('inspector-drawer')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '收起管理' })); expect(screen.queryByLabelText('Team Admin')).toBeNull();
  });

  it('历史 users 深链在中栏展开，不叠加抽屉', async () => {
    setWidth(1024); setHash('#console/resources/team-agents?team=alpha&edit=true&panel=users&inspect=1'); renderSection(); await layoutIs('dual'); expect(screen.getByLabelText('Team Admin')).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByTestId('inspector-drawer')).toBeNull(); await waitFor(() => expect(window.location.hash).not.toContain('inspect=1'));
  });
});

describe('TeamAgentsWorkbench · 多栏行为（行点击 = 选中，不弹大弹窗）', () => {
  it('triple：团队 / Manager / 成员行点击只更新 Inspector 与拓扑', async () => {
    renderSection();
    await layoutIs('triple');
    // 初始兜底选中 alpha（Inspector 已展示）。
    expect(screen.queryByRole('region', { name: '实体详情' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    clickListButton(listRegion(), 'boss');
    await waitFor(() =>
      expect(within(inspectorRegion()).getByRole('heading', { name: 'boss' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');
    await waitFor(() =>
      expect(within(inspectorRegion()).getByRole('heading', { name: 'w1' })).toBeInTheDocument(),
    );
    expect(document.querySelector('[data-worker-name="w1"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TeamAgentsWorkbench · A3 右栏 Inspector', () => {
  it('triple：无选中 → 占位引导', async () => {
    mockState.teams = [];
    renderSection();
    await layoutIs('triple');
    expect(within(inspectorRegion()).getByText('未选中实体')).toBeInTheDocument();
  });

  it('团队选中显示中栏信息，设置也在原位展开', async () => {
    renderSection(); await layoutIs('triple'); clickListButton(listRegion(), 'beta'); expect(screen.queryByRole('region', { name: '实体详情' })).toBeNull(); expect(within(topologyHeader()).getByRole('heading', { name: 'Beta' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '查看团队详情' })); expect(screen.getByRole('button', { name: '返回团队详情' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('团队基础字段在中栏，Agent 点击后右侧展示自身详情', async () => {
    renderSection(); await layoutIs('triple'); expect(screen.getByRole('region', { name: '基础信息' })).toHaveTextContent('负责人'); expect(screen.queryByRole('region', { name: '实体详情' })).toBeNull(); clickTopologyMember('w1'); expect(within(inspectorRegion()).getByRole('heading', { name: 'w1' })).toBeInTheDocument();
  });

  it('triple：Worker 选中 → 角色徽标 + 快动作 + 分区；点分区开大弹窗直达该分区', async () => {
    renderSection();
    await layoutIs('triple');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');
    const inspector = inspectorRegion();
    expect(within(inspector).getByRole('heading', { name: 'w1' })).toBeInTheDocument();
    expect(within(inspector).getByText('成员')).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: /休眠/ })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: /重启/ })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: /私聊/ })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: /删除/ })).toBeInTheDocument();

    fireEvent.click(within(inspector).getByRole('button', { name: 'MCP' }));
    const dialog = await screen.findByRole('dialog', { name: 'w1 · MCP' });
    // R1 分区直出：无垂直 tab 列表，MCP 分区正文直接呈现。
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'MCP', level: 3 })).toBeInTheDocument();
    // URL 带实体 / edit / panel（A4）。
    expect(window.location.hash).toContain('agent=w1');
    expect(window.location.hash).toContain('edit=true');
    expect(window.location.hash).toContain('panel=mcp');
  });

  it('triple：Manager 选中 → Manager 徽标 + 休眠/唤醒、重启、私聊（L1）', async () => {
    renderSection();
    await layoutIs('triple');
    clickListButton(listRegion(), 'boss');
    const inspector = inspectorRegion();
    expect(within(inspector).getByRole('heading', { name: 'boss' })).toBeInTheDocument();
    expect(within(inspector).getByText('Manager')).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: /休眠/ })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: /重启/ })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: /私聊/ })).toBeInTheDocument();
    for (const title of ['基本信息', '模型', '提示词', '技能', '环境变量', '运行参数', '日志']) {
      expect(within(inspector).getByRole('button', { name: title })).toBeInTheDocument();
    }
  });

  it('triple：Worker 选中 → 分区按钮列表下方常驻只读详情（②），分区按钮仍开大弹窗', async () => {
    renderSection();
    await layoutIs('triple');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');
    const inspector = inspectorRegion();
    await waitFor(() =>
      expect(within(inspector).getByRole('heading', { name: 'w1' })).toBeInTheDocument(),
    );
    // ② 只读详情（WorkerDetailSummary：补充字段，不再显示健康评分）渲染在分区按钮列表之后。
    const sectionList = within(inspector).getByRole('list', { name: '详情分区' });
    const readonlyLabel = within(inspector).getByText('只读详情');
    expect(within(screen.getByTestId('team-agents-section')).queryByText('实时')).not.toBeInTheDocument();
    expect(readonlyLabel.compareDocumentPosition(sectionList) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(within(inspector).getByText('容器状态')).toBeInTheDocument();
    expect(within(inspector).getByText('工具调用（24 小时）')).toBeInTheDocument();
    for (const label of ['可用性', '稳定性', '就绪度']) expect(within(inspector).queryByText(label)).not.toBeInTheDocument();
    expect(within(inspector).getAllByText('运行中')).toHaveLength(1);
    // 分区按钮入口行为不变：点击仍开可编辑大弹窗（分区直出）。
    fireEvent.click(within(inspector).getByRole('button', { name: 'MCP' }));
    const dialog = await screen.findByRole('dialog', { name: 'w1 · MCP' });
    expect(within(dialog).queryByRole('tablist')).toBeNull();
  });
});

describe('TeamAgentsWorkbench · A4 URL 状态（深链 / 前进后退 / Esc）', () => {
  it('?tab=agents&agent=w1&edit=true → 选中 Worker 并开弹窗', async () => {
    setHash('#console/resources/team-agents?tab=agents&agent=w1&edit=true');
    renderSection();
    await layoutIs('triple');
    const dialog = await screen.findByRole('dialog', { name: 'w1 · 基础配置' });
    // R1 分区直出：basic 字段直接呈现，无 tab 列表。
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    expect(within(dialog).getByText('模型 ID')).toBeInTheDocument();
    expect(within(dialog).getByText('w1-model')).toBeInTheDocument();
  });

  it('团队编辑深链打开原位设置', async () => {
    setHash('#console/resources/team-agents?tab=teams&team=beta&edit=true'); renderSection(); await layoutIs('triple'); expect(screen.getByRole('button', { name: '返回团队详情' })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: /基本信息/ })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('?manager=boss&edit=true → 选中 Manager 并开弹窗', async () => {
    setHash('#console/resources/team-agents?manager=boss&edit=true');
    renderSection();
    await layoutIs('triple');
    const dialog = await screen.findByRole('dialog', { name: 'boss · 基本信息' });
    expect(within(dialog).getByText('boss · 基本信息')).toBeInTheDocument();
    // basic 分区正文（连接信息）直接呈现。
    expect(within(dialog).getByRole('heading', { name: '连接信息', level: 3 })).toBeInTheDocument();
  });

  it('成员深链在中栏展开，收起管理后清理 URL', async () => {
    setHash('#console/resources/team-agents?team=alpha&edit=true&panel=users'); renderSection(); await layoutIs('triple'); expect(screen.getByLabelText('Team Admin')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '收起管理' })); await waitFor(() => expect(window.location.hash).not.toContain('edit=true')); expect(window.location.hash).not.toContain('panel='); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('前进 / 后退（hashchange）还原选择与弹窗状态', async () => {
    renderSection();
    await layoutIs('triple');
    navigateHash('#console/resources/team-agents?tab=agents&agent=w1&edit=true&panel=skills');
    const dialog = await screen.findByRole('dialog', { name: 'w1 · 技能' });
    // R1 分区直出：技能分区正文直接呈现。
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    expect(within(dialog).getByRole('heading', { name: '技能', level: 3 })).toBeInTheDocument();

    // 回到「选中、无编辑」状态：弹窗收掉，选中保留。
    navigateHash('#console/resources/team-agents?tab=agents&agent=w1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(inspectorRegion()).getByRole('heading', { name: 'w1' })).toBeInTheDocument();
  });

  it('?tab=agents&agent=w1（无 edit）→ 选中 Worker，右栏展示，不弹窗', async () => {
    setHash('#console/resources/team-agents?tab=agents&agent=w1');
    renderSection();
    await layoutIs('triple');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(inspectorRegion()).getByRole('heading', { name: 'w1' })).toBeInTheDocument();
    expect(window.location.hash).toContain('agent=w1');
    expect(window.location.hash).not.toContain('edit=true');
  });

  it('?manager=boss（无 edit）→ 选中 Manager，不弹窗', async () => {
    setHash('#console/resources/team-agents?manager=boss');
    renderSection();
    await layoutIs('triple');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(inspectorRegion()).getByRole('heading', { name: 'boss' })).toBeInTheDocument();
  });

  it('dual：?agent=w1（无 edit）深链 → 选中 + 抽屉展示，不弹分区弹窗', async () => {
    setWidth(1024);
    setHash('#console/resources/team-agents?tab=agents&agent=w1');
    renderSection();
    await layoutIs('dual');
    const drawer = await screen.findByTestId('inspector-drawer');
    expect(within(drawer).getByRole('heading', { name: 'w1' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /w1/ })).toBeNull();
  });

  it('团队 inspect 深链不再打开抽屉', async () => {
    setWidth(1024); setHash('#console/resources/team-agents?team=beta&inspect=1'); renderSection(); await layoutIs('dual'); expect(within(topologyHeader()).getByRole('heading', { name: 'Beta' })).toBeInTheDocument(); expect(screen.queryByTestId('inspector-drawer')).toBeNull();
  });
});

describe('TeamAgentsWorkbench · 单栏钻取（single <840，行为不变）', () => {
  it('768：起始列表；选团队切拓扑，返回回列表', async () => {
    setWidth(768);
    renderSection();
    await layoutIs('single');
    expect(shell().children).toHaveLength(1);
    expect(screen.queryByTestId('team-topology-header')).toBeNull();

    clickListButton(listRegion(), 'alpha');
    expect(topologyHeader()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '团队列表' })).toBeNull();

    const back = screen.getByRole('button', { name: '团队列表' });
    expect(back).toHaveClass('min-h-11');
    fireEvent.click(back);

    await waitFor(() => expect(listRegion()).toBeInTheDocument());
    expect(screen.queryByTestId('team-topology-header')).toBeNull();
  });

  it('768：Worker 点击开详情弹窗；关掉后选中高亮保留', async () => {
    setWidth(768);
    renderSection();
    await layoutIs('single');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');

    const dialog = await screen.findByRole('dialog', { name: 'w1 · 基础配置' });
    expect(within(dialog).getAllByText('w1-model').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-worker-name="w1"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    );

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.querySelector('[data-worker-name="w1"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
  });

  it('768：独立 Worker 点击开弹窗；关掉后落在上下文卡', async () => {
    setWidth(768);
    renderSection();
    await layoutIs('single');

    const region = await openStandaloneRow();
    clickListButton(region, 'solo');
    await screen.findByRole('dialog', { name: 'solo · 基础配置' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText(/智能体（不属于任何团队）：能运行/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '团队列表' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '回团队列表' }));
    await waitFor(() => expect(listRegion()).toBeInTheDocument());
  });

  it('768：Manager 行点击开详情弹窗', async () => {
    setWidth(768);
    renderSection();
    await layoutIs('single');

    clickListButton(listRegion(), 'boss');
    const dialog = await screen.findByRole('dialog', { name: 'boss · 基本信息' });
    expect(within(dialog).getByText('boss · 基本信息')).toBeInTheDocument();
  });
});

describe('TeamAgentsWorkbench · 详情大弹窗（R1 分区直出 + R2 单一入口 + A3 直达分区）', () => {
  it('团队齿轮保持触控尺寸并在中栏展开设置', async () => {
    renderSection(); await layoutIs('triple'); const gear = screen.getByRole('button', { name: '查看团队详情' }); expect(gear).toHaveClass('min-h-11'); fireEvent.click(gear); expect(screen.getByRole('button', { name: '返回团队详情' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('返回团队详情关闭原位设置并保留选择', async () => {
    renderSection(); await layoutIs('triple'); fireEvent.click(screen.getByRole('button', { name: '查看团队详情' })); fireEvent.click(screen.getByRole('button', { name: '返回团队详情' })); expect(within(topologyHeader()).getByRole('heading', { name: 'Alpha' })).toBeInTheDocument(); expect(screen.getByRole('region', { name: 'Agent 成员' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('团队描述原位编辑不产生浮层，取消后不提交', async () => {
    renderSection(); await layoutIs('triple'); fireEvent.click(screen.getByRole('button', { name: '编辑描述' })); fireEvent.change(screen.getByRole('textbox', { name: '团队描述' }), { target: { value: '未保存描述' } }); expect(screen.queryByRole('dialog')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(screen.queryByRole('textbox', { name: '团队描述' })).toBeNull();
  });

  it('dialog sizing: responsive large classes with a narrow (<640px) variant', async () => {
    setWidth(768);
    renderSection();
    await layoutIs('single');

    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');
    const dialog = await screen.findByRole('dialog', { name: 'w1 · 基础配置' });
    expect(dialog.className).toContain('w-[96vw]');
    expect(dialog.className).toContain('max-h-[94vh]');
    expect(dialog.className).toContain('sm:w-[min(1200px,94vw)]');
    expect(dialog.className).toContain('sm:max-h-[88vh]');
    // 内容区独立滚动（body 可滚、外壳裁切）。
    expect(dialog.className).toContain('overflow-hidden');
  });
});

describe('TeamAgentsWorkbench · 齿轮按布局分派（查看团队详情）', () => {
  it('triple：齿轮打开中栏设置，保留所有配置入口', async () => {
    renderSection(); await layoutIs('triple'); fireEvent.click(screen.getByRole('button', { name: '查看团队详情' })); for (const name of [/基本信息/, /成员管理/, /Agent 管理/]) expect(screen.getByRole('tab', { name })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dual：齿轮原位展开，再次进入正常', async () => {
    setWidth(1024); renderSection(); await layoutIs('dual'); fireEvent.click(screen.getByRole('button', { name: '查看团队详情' })); expect(screen.queryByTestId('inspector-drawer')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '返回团队详情' })); fireEvent.click(screen.getByRole('button', { name: '查看团队详情' })); expect(screen.getByRole('tab', { name: /基本信息/ })).toBeInTheDocument();
  });

  it('single：团队设置仍在中栏，不打开弹窗', async () => {
    setWidth(768); renderSection(); await layoutIs('single'); clickListButton(listRegion(), 'alpha'); fireEvent.click(screen.getByRole('button', { name: '查看团队详情' })); expect(screen.getByRole('tab', { name: /基本信息/ })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TeamAgentsWorkbench · 悬浮 affordance（列表侧，对齐 shiyiyue1102）', () => {
  it('列表团队名 / Manager 名 hover:underline；拓扑成员名 hover:underline', async () => {
    renderSection();
    await layoutIs('triple');
    const list = listRegion();
    // Manager 行名（可点击行 → 名字下划线反馈）。
    expect(within(list).getByText('boss')).toHaveClass('hover:underline');
    // 团队行名（初始兜底选中 = alpha）。
    const alphaRow = list.querySelector('button[aria-current="true"]') as HTMLElement;
    const alphaName = Array.from(alphaRow.querySelectorAll('span')).find(
      (span) => span.childElementCount === 0 && span.textContent?.trim() === 'alpha',
    );
    expect(alphaName).toBeTruthy();
    expect(alphaName).toHaveClass('hover:underline');
    // 拓扑成员名（alpha 已选中 → 拓扑在列）。
    const leadRow = document.querySelector('[data-worker-name="lead"]') as HTMLElement;
    expect(within(leadRow).getByText('lead')).toHaveClass('hover:underline');
  });
});

describe('TeamAgentsWorkbench · 工作台壳（统一列表）', () => {
  it('团队行以两行显示中文名及英文标识、人数，长名称截断且数量不收缩', async () => {
    const displayName = '这是一个超过列表宽度的中文团队名称';
    const name = 'a-very-long-english-team-identifier';
    mockState.teams = [{ ...teamsFixture[0], name, teamName: displayName }];
    renderSection();
    await layoutIs('triple');
    const list = listRegion();
    const chinese = within(list).getByText(displayName);
    const english = within(list).getByText(name);
    const count = within(list).getByText('· 成员 1 · Agent 2');
    expect(chinese).toHaveClass('truncate');
    expect(chinese).toHaveAttribute('title', displayName);
    expect(english).toHaveClass('min-w-0', 'truncate');
    expect(english).toHaveAttribute('title', name);
    expect(english.parentElement).toBe(count.parentElement);
    expect(english.parentElement).toHaveClass('whitespace-nowrap');
    expect(count).toHaveClass('shrink-0');
    expect(chinese.parentElement?.parentElement?.children).toHaveLength(2);
  });

  it('团队详情占用中间与右侧空间，Agent 选择才展示右栏', async () => {
    renderSection(); await layoutIs('triple'); expect(listRegion()).toBeInTheDocument(); expect(screen.getByRole('region', { name: '团队拓扑' })).toBeInTheDocument(); expect(screen.queryByRole('region', { name: '实体详情' })).toBeNull(); clickTopologyMember('w1'); expect(inspectorRegion()).toBeInTheDocument();
  });

  it('no team/agent tab UI; managers, teams and standalone workers share one list', async () => {
    renderSection();
    await layoutIs('triple');
    const list = listRegion();
    expect(within(list).queryByRole('tab')).toBeNull();
    expect(within(list).queryByRole('tablist')).toBeNull();
    expect(within(list).getByText('boss')).toBeInTheDocument(); // Manager 行
    expect(within(list).getByText('alpha')).toBeInTheDocument(); // 团队行
    expect(within(list).getByText(/智能体（/)).toBeInTheDocument(); // 折叠行
  });

  it('C：壳撑满父容器——无 max-h 上限，高度 calc(100dvh-13rem)，下限 420px', async () => {
    renderSection();
    await layoutIs('triple');
    expect(shell().className).not.toContain('max-h-[1200px]');
    expect(shell().className).toContain('h-[calc(100dvh-13rem)]');
    expect(shell().className).toContain('min-h-[420px]');
  });
});

describe('TeamAgentsWorkbench · Agent 入口', () => {
  it('triple：展开独立行，选中显示上下文卡（不弹大弹窗）', async () => {
    renderSection();
    await layoutIs('triple');
    const region = await openStandaloneRow();
    // 行内含会话灯（role=img，aria-label=运行中）→ 可访问名称是「运行中 solo」。
    expect(within(region).getByRole('button', { name: /solo/ })).toBeInTheDocument();

    clickListButton(region, 'solo');
    expect(screen.queryByRole('dialog')).toBeNull();
    // 中栏落在上下文卡。
    expect(screen.getByText(/智能体（不属于任何团队）：能运行/)).toBeInTheDocument();
    expect(within(inspectorRegion()).getByRole('heading', { name: 'solo' })).toBeInTheDocument();
  });
});

describe('TeamAgentsWorkbench · 旧 hash 深链（初始选中）', () => {
  it('legacy workers route preselects the first standalone worker', async () => {
    setHash('#console/resources/workers');
    renderSection();
    await layoutIs('triple');
    expect(document.querySelector('[role="tab"]')).toBeNull();
    // agents 意图：展开 Agent 行并选中首个 Agent（上下文卡）。
    expect(within(listRegion()).getByText('solo')).toBeInTheDocument();
    // 卡片正文是一整段 p，用正则匹配开头。
    expect(screen.getByText(/智能体（不属于任何团队）：能运行/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('legacy teams route preselects the first team', async () => {
    setHash('#console/resources/teams');
    renderSection();
    await layoutIs('triple');
    expect(within(topologyHeader()).getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('?team= preselects the named team', async () => {
    setHash('#console/resources/team-agents?team=beta');
    renderSection();
    await layoutIs('triple');
    expect(within(topologyHeader()).getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  });

  it('explicit tab=agents query maps to the agents intent', async () => {
    setHash('#console/resources/team-agents?tab=agents');
    renderSection();
    await layoutIs('triple');
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(within(listRegion()).getByText('solo')).toBeInTheDocument();
    expect(screen.getByText(/智能体（不属于任何团队）：能运行/)).toBeInTheDocument();
  });
});

describe('TeamAgentsWorkbench · 搜索（A3）', () => {
  it('keeps teams with matched members and marks the matched names', async () => {
    mockState.searchQuery = 'w1';
    renderSection();
    await layoutIs('triple');
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
    await layoutIs('triple');
    expect(within(listRegion()).getByText('没有匹配的团队 / 成员')).toBeInTheDocument();
  });
});

describe('TeamAgentsWorkbench · 权限门控（L1，在 Worker 弹窗内）', () => {
  // 单栏独立 Worker 弹窗无 ?panel= → initialTab 缺省 → 面板回退 'full'
  // （动作条可见），L1 删除门控在此路径断言。
  it('hides the worker delete action below L1', async () => {
    mockState.userLevel = 2;
    setWidth(768);
    renderSection();
    await layoutIs('single');
    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    const dialog = await screen.findByRole('dialog', { name: 'solo · 基础配置' });
    expect(within(dialog).queryByRole('button', { name: /删除/ })).toBeNull();
  });

  it('shows the worker delete action at L1', async () => {
    mockState.userLevel = 3;
    setWidth(768);
    renderSection();
    await layoutIs('single');
    const region = await openStandaloneRow();
    clickListButton(region, 'solo');

    const dialog = await screen.findByRole('dialog', { name: 'solo · 基础配置' });
    expect(within(dialog).getByRole('button', { name: /删除/ })).toBeInTheDocument();
  });
});

describe('TeamAgentsWorkbench · 千锻入口（拓扑承载）', () => {
  it('topology entry card opens the dialog; injected refreshes teams', async () => {
    renderSection();
    await layoutIs('triple');
    // alpha 初始兜底选中 → 拓扑已显示。
    const card = screen.getByRole('button', { name: '打开千锻' });
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
    await layoutIs('triple');
    clickListButton(listRegion(), 'alpha');
    clickTopologyMember('w1');

    // 多栏：选中即止（不弹大弹窗）。
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '打开千锻' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开千锻' }));
    expect(screen.getByTestId('mock-millforge-dialog')).toHaveTextContent(
      'millforge-dialog:alpha:workers-4',
    );
  });
});

describe('TeamAgentsWorkbench · 创建入口与团队设置草稿', () => {
  it('keeps create-team and create-agent entries on the page', async () => {
    renderSection();
    await layoutIs('triple');
    fireEvent.click(screen.getByRole('button', { name: /创建团队/ }));
    expect(screen.getByText('team-create-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /创建智能体/ }));
    expect(screen.getByText('worker-create-dialog')).toBeInTheDocument();
  });

  it('keeps an unsaved team description across a model catalog refresh inline', async () => {
    const client = makeClient();
    const { rerender } = renderSection(client);
    await layoutIs('triple');
    fireEvent.click(screen.getByRole('button', { name: '编辑描述' }));
    fireEvent.change(screen.getByRole('textbox', { name: '团队描述' }), { target: { value: '草稿不丢' } });
    mockState.modelOptions = [{ alias: 'm1', kind: 'configured' }];
    rerender(<QueryClientProvider client={client}><TooltipProvider><TeamAgentsWorkbench /></TooltipProvider></QueryClientProvider>);
    expect(screen.getByRole('textbox', { name: '团队描述' })).toHaveValue('草稿不丢');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
