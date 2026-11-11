import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

const mocks = vi.hoisted(() => ({
  updateTeamAsync: vi.fn(),
  updateTeamMutate: vi.fn(),
  updateWorkerAsync: vi.fn(),
  updateWorkerMutate: vi.fn(),
  deleteTeamAsync: vi.fn(),
  deleteTeamMutate: vi.fn(),
  createTeamMutate: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useCreateTeam: () => ({ mutate: mocks.createTeamMutate, mutateAsync: vi.fn(), isPending: false }),
  useUpdateTeam: () => ({
    mutate: mocks.updateTeamMutate,
    mutateAsync: mocks.updateTeamAsync,
    isPending: false,
  }),
  useUpdateWorker: () => ({
    mutate: mocks.updateWorkerMutate,
    mutateAsync: mocks.updateWorkerAsync,
    isPending: false,
  }),
  useDeleteTeam: () => ({
    mutate: mocks.deleteTeamMutate,
    mutateAsync: mocks.deleteTeamAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/use-skill-center', () => ({
  useSkills: () => ({
    data: {
      skills: [
        { name: 's1', description: '一', source: 'custom', version: '1', fileCount: 1, createdAt: '' },
        { name: 's2', description: '二', source: 'builtin', version: '1', fileCount: 1, createdAt: '' },
      ],
      total: 2,
    },
    isFetching: false,
    refetch: mocks.refetch,
  }),
}));

// 批量模型画笔：原生 input，测试里直接输入模型名。
vi.mock('@/components/dashboard/sections/shared/model-selector', () => ({
  ModelSelector: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange: (_value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

// 行内模型弹窗走真实组件（PUT 由 useUpdateWorker 下发，见下方断言）。

vi.mock('@/components/dashboard/sections/mcps/mcp-selector', () => ({
  McpSelector: ({
    value,
    onChange,
  }: {
    value: Array<{ name: string; url: string; transport: string }>;
    onChange: (_next: Array<{ name: string; url: string; transport: string }>) => void;
  }) => (
    <div>
      <span>mcp:{value.map((item) => item.name).join(',') || '-'}</span>
      <button
        type="button"
        onClick={() => onChange([...value, { name: 'new-mcp', url: 'http://mcp', transport: 'http' }])}
      >
        选择 MCP
      </button>
    </div>
  ),
}));

vi.mock('@/components/dashboard/sections/skills/skill-upload-dialog', () => ({
  SkillUploadDialog: () => <div>upload-dialog</div>,
}));
vi.mock('@/components/dashboard/sections/skills/skill-edit-dialog', () => ({
  SkillEditDialog: () => <div>edit-dialog</div>,
}));
vi.mock('@/components/dashboard/sections/skills/skill-detail-dialog', () => ({
  SkillDetailDialog: () => <div>detail-dialog</div>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// ---- TeamsSection 入口测试所需的列表 hooks ----
vi.mock('@/hooks/use-agentteams-teams', () => ({
  useTeams: () => ({
    data: [teamFixture],
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
    isRefetching: false,
  }),
}));
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: workersFixture }),
}));
vi.mock('@/hooks/use-agentteams-managers', () => ({
  useManagers: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-model-selection', () => ({
  useModelSelection: () => ({
    options: [],
    providers: [],
    aiRoutes: [],
    isLoading: false,
    sessionIssue: null,
  }),
}));
vi.mock('@/lib/search-context', () => ({
  useSearch: () => ({ searchQuery: '', setSearchQuery: vi.fn() }),
}));
vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: () => ({ isConnected: true, userLevel: 3 }),
}));

// shadcn Select → 原生 select（与 team-edit-dialog.test 同款）
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (_value: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

// 旧详情弹窗：若仍被渲染则出现该标记（回归守卫）。
vi.mock('./team-detail-dialog', () => ({
  TeamDetailDialog: () => <div>legacy-team-detail</div>,
}));

import { TeamDrawer } from './team-drawer';
import { TeamTable } from './team-table';
import { TeamsSection } from '../teams-section';
import { TooltipProvider } from '@/components/ui/tooltip';

function worker(
  name: string,
  patch: Partial<WorkerResponse> = {},
): WorkerResponse {
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
    team: 'alpha',
    role: 'worker',
    skills: [],
    mcpServers: [],
    ...patch,
  } as unknown as WorkerResponse;
}

const teamFixture = {
  name: 'alpha',
  teamName: 'Alpha',
  phase: 'Active',
  description: '原描述',
  admin: null,
  humanMembers: [],
  leaderName: 'lead',
  leaderHeartbeat: null,
  workerIdleTimeout: '720m',
  teamRoomID: '!team:server',
  leaderDMRoomID: '!dm:server',
  leaderReady: true,
  readyWorkers: 3,
  totalWorkers: 3,
  message: '',
  peerMentions: true,
  workerNames: ['w1', 'w2'],
  workerExposedPorts: {},
} as unknown as TeamResponse;

const workersFixture = [worker('lead'), worker('w1'), worker('w2')];

function renderWithClient(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

function renderDrawer(userLevel = 3) {
  return renderWithClient(
    <TeamDrawer
      team={teamFixture}
      allTeams={[teamFixture]}
      workers={workersFixture}
      modelOptions={[]}
      userLevel={userLevel}
      onOpenChange={vi.fn()}
      onChanged={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
}

function selectAllOptions() {
  return screen
    .getAllByRole('combobox')
    .filter((element): element is HTMLSelectElement => element instanceof HTMLSelectElement);
}

/** 批量画笔：从角色列打开统一模型弹窗，选模型并保存（只刷本地草稿）。 */
async function paintBatch(
  testId: 'batch-leader' | 'batch-workers',
  dialogTitle: string,
  model: string,
) {
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button', { name: '设置模型' }));
  // 抽屉自身也是 role=dialog，按标题锁定嵌套的模型弹窗。
  const dialog = screen.getByRole('dialog', { name: dialogTitle });
  fireEvent.change(within(dialog).getByLabelText('请求模型别名'), {
    target: { value: model },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: dialogTitle })).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  // jsdom 无 ResizeObserver；Radix 的 Tooltip/尺寸钩子在布局阶段会用到。
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.updateTeamAsync.mockResolvedValue(teamFixture);
  mocks.updateWorkerAsync.mockResolvedValue({});
  mocks.deleteTeamAsync.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: [teamFixture] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TeamDrawer · 分区与骨架', () => {
  it('渲染四分区（+未归属/危险区），团队技能默认收起', () => {
    renderDrawer();
    for (const title of ['基本信息', 'LLM 调优', '团队成员', '团队技能', '加入未归属 Worker', '危险区']) {
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'LLM 调优' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '危险区' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByPlaceholderText('搜索技能…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '团队技能' }));
    expect(screen.getByPlaceholderText('搜索技能…')).toBeInTheDocument();
  });

  it('Sheet 宽 560 / 窄屏全宽且不产生横向滚动', () => {
    renderDrawer();
    const sheet = screen.getByTestId('team-drawer');
    expect(sheet.className).toContain('w-full');
    expect(sheet.className).toContain('sm:w-[560px]');
    expect(sheet.className).toContain('sm:max-w-[560px]');
    expect(sheet.className).toContain('overflow-x-hidden');
    const body = document.querySelector('[data-slot="team-drawer-body"]');
    expect(body?.className).toContain('overflow-x-hidden');
    expect(body?.className).toContain('min-w-0');
  });

  it('危险区删除按钮仅 L1（dashboard level 3）可见', () => {
    const { unmount } = renderDrawer(2);
    fireEvent.click(screen.getByRole('button', { name: '危险区' }));
    expect(screen.queryByTestId('danger-delete')).toBeNull();
    expect(screen.getByText('删除团队需要管理员（L1）权限。')).toBeInTheDocument();
    unmount();
    renderDrawer(3);
    fireEvent.click(screen.getByRole('button', { name: '危险区' }));
    expect(screen.getByTestId('danger-delete')).toBeInTheDocument();
  });

  it('千锻入口不在团队设置抽屉（只在「团队与Agent」拓扑头部，对齐插件）', () => {
    renderDrawer();
    expect(screen.queryByTestId('millforge-card')).toBeNull();
    expect(screen.queryByTestId('millforge-logo')).toBeNull();
  });
});

describe('TeamDrawer · 基本信息 / LLM 调优', () => {
  it('保存基本信息调用 updateTeam（只发改动字段）', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '新描述' } });
    fireEvent.click(screen.getByTestId('basic-save'));
    await waitFor(() =>
      expect(mocks.updateTeamAsync).toHaveBeenCalledWith({
        name: 'alpha',
        data: { description: '新描述' },
      }),
    );
  });

  it('团队 LLM 调优随同一次团队 PUT 提交', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'LLM 调优' }));
    fireEvent.change(screen.getByLabelText('最大重试次数'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('basic-save'));
    await waitFor(() =>
      expect(mocks.updateTeamAsync).toHaveBeenCalledWith({
        name: 'alpha',
        data: { llmMaxRetries: '5' },
      }),
    );
  });

  it('无改动时不发 PUT', async () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('basic-save'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.updateTeamAsync).not.toHaveBeenCalled();
  });
});

describe('TeamDrawer · 团队成员', () => {
  it('批量 Leader 模型只刷 Leader 行，保存只写该行 updateWorker', async () => {
    renderDrawer();
    await paintBatch('batch-leader', '批量设置模型 - Leader 批', 'leader-batch');
    expect(within(screen.getByTestId('batch-leader')).getByText('leader-batch')).toBeInTheDocument();
    expect(screen.getByTestId('member-lead')).toHaveTextContent('leader-batch');
    expect(screen.getByTestId('member-w1')).toHaveTextContent('w1-model');

    fireEvent.click(screen.getByTestId('members-save'));
    await waitFor(() =>
      expect(mocks.updateWorkerAsync).toHaveBeenCalledWith({
        name: 'lead',
        data: { model: 'leader-batch' },
      }),
    );
    expect(mocks.updateWorkerAsync).toHaveBeenCalledTimes(1);
  });

  it('Workers 批量只刷 worker 行', async () => {
    renderDrawer();
    await paintBatch('batch-workers', '批量设置模型 - Workers 批', 'worker-batch');
    fireEvent.click(screen.getByTestId('members-save'));
    await waitFor(() => expect(mocks.updateWorkerAsync).toHaveBeenCalledTimes(2));
    expect(mocks.updateWorkerAsync.mock.calls.map((call) => call[0].name)).toEqual(['w1', 'w2']);
    expect(mocks.updateWorkerAsync.mock.calls.map((call) => call[0].data.model)).toEqual([
      'worker-batch',
      'worker-batch',
    ]);
  });

  it('行内「改模型」打开统一模型弹窗，保存走 updateWorker', async () => {
    renderDrawer();
    const rows = screen.getAllByRole('button', { name: '改模型' });
    fireEvent.click(rows[1]);
    const input = await screen.findByPlaceholderText('例如 team-chat');
    fireEvent.change(input, { target: { value: 'm1-new' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mocks.updateWorkerMutate).toHaveBeenCalledWith(
        { name: 'w1', data: { model: 'm1-new' } },
        expect.anything(),
      ),
    );
  });

  it('缺失 Worker 红标并禁止提交，移除后恢复', () => {
    const ghostTeam = { ...teamFixture, workerNames: ['w1', 'ghost'] } as TeamResponse;
    renderWithClient(
      <TeamDrawer
        team={ghostTeam}
        allTeams={[ghostTeam]}
        workers={workersFixture}
        modelOptions={[]}
        userLevel={3}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/以下 Worker 不存在/)).toHaveTextContent('ghost');
    expect(screen.getByTestId('members-save')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '移除 ghost' }));
    expect(screen.queryByText(/以下 Worker 不存在/)).toBeNull();
    expect(screen.getByTestId('members-save')).toBeEnabled();
  });

  it('添加成员只列已有 Worker，保存提交合并后的 workerNames', async () => {
    const loose = worker('w9', { team: '' });
    renderWithClient(
      <TeamDrawer
        team={teamFixture}
        allTeams={[teamFixture]}
        workers={[...workersFixture, loose]}
        modelOptions={[]}
        userLevel={3}
        onOpenChange={vi.fn()}
      />,
    );
    const addSelect = selectAllOptions().find((select) =>
      Array.from(select.options).some((option) => option.value === 'w9'),
    );
    expect(addSelect).toBeTruthy();
    fireEvent.change(addSelect as HTMLSelectElement, { target: { value: 'w9' } });
    expect(await screen.findByTestId('member-w9')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('members-save'));
    await waitFor(() =>
      expect(mocks.updateTeamAsync).toHaveBeenCalledWith({
        name: 'alpha',
        data: { workerNames: ['w1', 'w2', 'w9'], leader: { name: 'lead' } },
      }),
    );
  });

  it('只改模型时不再重复 PUT 团队成员', async () => {
    renderDrawer();
    await paintBatch('batch-leader', '批量设置模型 - Leader 批', 'leader-batch');
    fireEvent.click(screen.getByTestId('members-save'));
    await waitFor(() => expect(mocks.updateWorkerAsync).toHaveBeenCalled());
    expect(mocks.updateTeamAsync).not.toHaveBeenCalled();
  });
});

describe('TeamDrawer · 团队技能（独立保存）', () => {
  it('分配矩阵保存走 updateWorker{skills}，不触发团队 PUT', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: '团队技能' }));
    fireEvent.click(screen.getByLabelText('w1 s1'));
    fireEvent.click(screen.getByTestId('skills-save'));
    await waitFor(() =>
      expect(mocks.updateWorkerAsync).toHaveBeenCalledWith({
        name: 'w1',
        data: { skills: ['s1'] },
      }),
    );
    expect(mocks.updateTeamAsync).not.toHaveBeenCalled();
  });

  it('MCP 卡保存写 updateWorker{mcpServers}，独立于团队保存', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: '团队技能' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑 w1 MCP' }));
    fireEvent.click(screen.getByRole('button', { name: '选择 MCP' }));
    expect(await screen.findByText('mcp:new-mcp')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mcp-save'));
    await waitFor(() =>
      expect(mocks.updateWorkerAsync).toHaveBeenCalledWith({
        name: 'w1',
        data: { mcpServers: [{ name: 'new-mcp', url: 'http://mcp', transport: 'http' }] },
      }),
    );
    expect(mocks.updateTeamAsync).not.toHaveBeenCalled();
  });
});

describe('TeamDrawer · 危险区', () => {
  it('删除需要输入团队名完全一致', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: '危险区' }));
    fireEvent.click(screen.getByTestId('danger-delete'));
    const confirm = await screen.findByTestId('danger-delete-confirm');
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('输入团队名以确认'), { target: { value: 'alph' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('输入团队名以确认'), { target: { value: 'alpha' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.deleteTeamAsync).toHaveBeenCalledWith('alpha'));
  });
});

describe('团队详情入口（表格行 / 卡片详情）', () => {
  function TableHarness() {
    const [selected, setSelected] = useState<TeamResponse | null>(null);
    return (
      <>
        <TeamTable
          teams={[teamFixture]}
          getAvailableFor={() => []}
          isAddWorkerOpen={() => false}
          onAddWorkerPopoverChange={() => {}}
          onView={setSelected}
          onEdit={() => {}}
          onDelete={() => {}}
          onAddWorker={() => {}}
          onShowTopology={() => {}}
          deletingTeamNames={new Set()}
        />
        <TeamDrawer
          team={selected}
          allTeams={[teamFixture]}
          workers={workersFixture}
          modelOptions={[]}
          userLevel={3}
          onOpenChange={(open) => !open && setSelected(null)}
        />
      </>
    );
  }

  it('表格行点击打开右侧 Sheet，旧详情弹窗不再出现', async () => {
    renderWithClient(<TableHarness />);
    fireEvent.click(screen.getByTestId('team-row-alpha'));
    expect(await screen.findByTestId('team-drawer')).toBeInTheDocument();
    expect(screen.queryByText('团队详情 - alpha')).toBeNull();
    expect(screen.queryByText('legacy-team-detail')).toBeNull();
  });

  it('卡片「详情」打开 Sheet（不再用 TeamDetailDialog）', async () => {
    renderWithClient(<TeamsSection />);
    const detailButtons = await screen.findAllByRole('button', { name: /详情/ });
    fireEvent.click(detailButtons[0]);
    expect(await screen.findByTestId('team-drawer')).toBeInTheDocument();
    expect(screen.queryByText('团队详情 - alpha')).toBeNull();
    expect(screen.queryByText('legacy-team-detail')).toBeNull();
  });

  it('表格操作列按钮不会误触整行（点击编辑不打开抽屉）', async () => {
    const onView = vi.fn();
    renderWithClient(
      <TeamTable
        teams={[teamFixture]}
        getAvailableFor={() => []}
        isAddWorkerOpen={() => false}
        onAddWorkerPopoverChange={() => {}}
        onView={onView}
        onEdit={() => {}}
        onDelete={() => {}}
        onAddWorker={() => {}}
        onShowTopology={() => {}}
        deletingTeamNames={new Set()}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'alpha 更多操作' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
    expect(onView).not.toHaveBeenCalled();
  });
});
