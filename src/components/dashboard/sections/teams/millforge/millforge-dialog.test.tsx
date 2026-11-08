import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  MillforgeBuildResult,
  MillforgeIndex,
  MillforgePack,
  TeamModulesResponse,
  TeamResponse,
  WorkerResponse,
} from '@/lib/agentteams-api';
import { ApiError } from '@/lib/api-error';

const mocks = vi.hoisted(() => ({
  api: {
    getMillforgeSource: vi.fn(),
    putMillforgeSource: vi.fn(),
    importMillforgePack: vi.fn(),
    getMillforgePacks: vi.fn(),
    getMillforgePackFile: vi.fn(),
    compileMillforge: vi.fn(),
    preflightMillforgeSouls: vi.fn(),
    injectMillforge: vi.fn(),
    rollbackMillforgeSoul: vi.fn(),
    promptMillforge: vi.fn(),
    parseMillforgeTeamJson: vi.fn(),
    getMillforgeInjections: vi.fn(),
    getMillforgeIndex: vi.fn(),
    getTeamModules: vi.fn(),
    getWorkerPlugins: vi.fn(),
    getManagerPlugins: vi.fn(),
    installTeamModule: vi.fn(),
    installWorkerPlugin: vi.fn(),
    installManagerPlugin: vi.fn(),
  },
}));

vi.mock('@/lib/agentteams-api', () => ({ agentteamsApi: mocks.api }));

vi.mock('@/hooks/use-agentteams-teams', () => ({
  useTeams: () => ({ data: [teamFixture] }),
}));
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: workersFixture }),
}));
vi.mock('@/hooks/use-agentteams-managers', () => ({
  useManagers: () => ({ data: [] }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// shadcn Select → 原生 select（与 team-drawer.test 同款）
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value?: string;
    onValueChange?: (_value: string) => void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
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

import { MillforgeDialog } from './millforge-dialog';

function worker(name: string, patch: Partial<WorkerResponse> = {}): WorkerResponse {
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
  description: '',
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

const workersFixture = [worker('lead', { role: 'team_leader' }), worker('w1'), worker('w2')];

const packFixture: MillforgePack = {
  pack: 'millforge',
  meta: {
    url: 'https://github.com/LUOSENGWA/millforge.git',
    ref: 'main',
    commit: 'abcdef1234567',
    imported_at: '2026-11-08T00:00:00Z',
  },
  index: {
    skeletons: [],
    industry: [],
    domain: [],
    fragments: [],
    teams: [],
  },
  parse_error: null,
};

const buildFixture: MillforgeBuildResult = {
  ok: true,
  build_id: 'b-1',
  pack: 'millforge',
  team: 'alpha',
  lang: 'zh',
  source: 'template',
  roles: [
    {
      role: 'lead-role',
      kind: 'leader',
      lines: 100,
      budget: 200,
      budget_ok: true,
      soul_sha256: 'a'.repeat(64),
      soul: '# LEAD SOUL',
    },
    {
      role: 'worker-role',
      kind: 'worker',
      lines: 90,
      budget: 200,
      budget_ok: true,
      soul_sha256: 'b'.repeat(64),
      soul: '# WORKER SOUL',
    },
  ],
  fragments: ['core/baseline'],
  spawn_specs: [],
  provenance: { millforge: true },
};

const moduleIndexFixture: MillforgeIndex = {
  schema: 1,
  channel: 'beta',
  source: 'github',
  repo: 'LUOSENGWA/millforge',
  fetched_at: '2026-11-08T00:00:00Z',
  modules: {
    teamharness: {
      kind: 'plugin',
      latest: '0.2.0',
      versions: {
        '0.1.0': { artifacts: [{ name: 'a.zip', sha256: 'a' }] },
        '0.2.0': { artifacts: [{ name: 'b.zip', sha256: 'b' }] },
      },
    },
    'up-to-date-mod': {
      kind: 'plugin',
      latest: '1.0.0',
      versions: { '1.0.0': { artifacts: [{ name: 'c.zip', sha256: 'c' }] } },
    },
    'inconsistent-mod': {
      kind: 'plugin',
      latest: '0.2.0',
      versions: {
        '0.1.0': { artifacts: [{ name: 'd.zip', sha256: 'd' }] },
        '0.2.0': { artifacts: [{ name: 'e.zip', sha256: 'e' }] },
      },
    },
    // CodingCLI 桥在索引里出现（真实 index 就这样），但千锻模块面必须过滤掉。
    'qwenpaw-qwencode-bridge': {
      kind: 'plugin',
      pluginId: 'qwen-code-bridge',
      latest: '0.3.0',
      versions: {
        '0.3.0': {
          artifacts: [{ name: 'qwenpaw-qwencode-bridge-0.3.0.zip', sha256: 'f' }],
        },
      },
    },
  },
};

const teamModulesFixture: TeamModulesResponse = {
  team: 'alpha',
  modules: [
    {
      module: 'teamharness',
      versions: { '0.1.0': 1 },
      consistent: true,
      members: [{ worker: 'w1', version: '0.1.0', loaded: true }],
    },
    {
      module: 'up-to-date-mod',
      versions: { '1.0.0': 1 },
      consistent: true,
      members: [],
    },
    {
      module: 'inconsistent-mod',
      versions: { '0.1.0': 1, '0.2.0': 1 },
      consistent: false,
      members: [
        { worker: 'w1', version: '0.1.0', loaded: true },
        { worker: 'w2', version: '0.2.0', loaded: true },
      ],
    },
    // 已装注册表里也可能出现桥（团队装了它）；千锻模块面同样不得渲染。
    {
      module: 'qwenpaw-qwencode-bridge',
      versions: { '0.2.0': 1 },
      consistent: true,
      members: [{ worker: 'w1', version: '0.2.0', loaded: true }],
    },
  ],
};

function renderDialog(overrides: { canInstall?: boolean; onInjected?: () => void } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const node = (
    <QueryClientProvider client={qc}>
      <MillforgeDialog
        open
        team={teamFixture}
        workers={workersFixture}
        canInstall={overrides.canInstall ?? true}
        onOpenChange={() => {}}
        onInjected={overrides.onInjected}
      />
    </QueryClientProvider>
  );
  return render(node);
}

function tabButton(name: string) {
  return screen.getAllByRole('tab', { name })[0];
}

/** Radix Tabs 在 mousedown 时切换（click 单独不发 mousedown）。 */
function switchTab(name: string) {
  const tab = tabButton(name);
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

/** pack 自动选中是异步的：编译按钮 enabled 才代表 core.pack 已就位。 */
async function waitForCompileReady() {
  const button = screen.getByTestId('millforge-compile');
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.values(mocks.api).forEach((mock) => mock.mockReset());
  mocks.api.getMillforgeSource.mockResolvedValue({
    kind: 'github',
    repo: 'LUOSENGWA/millforge',
    custom_url: '',
    resolved_url: 'https://github.com/LUOSENGWA/millforge.git',
  });
  mocks.api.putMillforgeSource.mockResolvedValue({
    kind: 'github',
    repo: 'LUOSENGWA/millforge',
    custom_url: '',
    resolved_url: 'https://github.com/LUOSENGWA/millforge.git',
  });
  mocks.api.getMillforgePacks.mockResolvedValue({ packs: [packFixture] });
  mocks.api.getMillforgeInjections.mockResolvedValue({ injections: [] });
  mocks.api.getMillforgeIndex.mockResolvedValue(moduleIndexFixture);
  mocks.api.getTeamModules.mockResolvedValue(teamModulesFixture);
  mocks.api.getWorkerPlugins.mockResolvedValue([]);
  mocks.api.getManagerPlugins.mockResolvedValue([]);
  mocks.api.compileMillforge.mockResolvedValue(buildFixture);
  mocks.api.preflightMillforgeSouls.mockResolvedValue({
    build_id: 'b-1',
    targets: [],
    conflict_count: 0,
  });
  mocks.api.injectMillforge.mockResolvedValue({
    ok: true,
    partial: false,
    build_id: 'b-1',
    team: 'alpha',
    souls: [
      { worker: 'lead', role_id: 'lead-role', status: 'ok', verified: true, mode: 'apply' },
      { worker: 'w1', role_id: 'worker-role', status: 'ok', verified: true, mode: 'apply' },
    ],
    created: [],
    core_skill: { status: 'skipped' },
  });
  mocks.api.installTeamModule.mockResolvedValue({ updated: ['w1', 'w2'] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MillforgeDialog · 四 tab 骨架', () => {
  it('标题带团队名，四个 tab 可切换', async () => {
    renderDialog();
    expect(screen.getByText('千锻 — alpha')).toBeInTheDocument();
    for (const name of ['注入', '自定义团队', '模块更新', '注入历史']) {
      expect(tabButton(name)).toBeInTheDocument();
    }
    switchTab('自定义团队');
    expect(await screen.findByLabelText('LLM 返回的 JSON')).toBeInTheDocument();
    switchTab('注入历史');
    expect(await screen.findByText('注入历史（最近 50 条）')).toBeInTheDocument();
  });
});

describe('MillforgeDialog · 注入 tab', () => {
  it('编译 → mapping 按团队 leader/worker 预填 → 注入调用正确 API 并刷新抽屉', async () => {
    const onInjected = vi.fn();
    renderDialog({ onInjected });

    expect(await screen.findByText('模板包（pack）')).toBeInTheDocument();
    fireEvent.click(await waitForCompileReady());
    await waitFor(() =>
      expect(mocks.api.compileMillforge).toHaveBeenCalledWith({
        pack: 'millforge',
        team: 'alpha',
        lang: 'zh',
        template: {
          team_combo: undefined,
          industry: undefined,
          domains: [],
          members: { leader: 1, workers: 2, critic: 0 },
        },
      }),
    );

    expect(await screen.findByText(/LEAD SOUL/)).toBeInTheDocument();
    expect(screen.getByText(/编译预览（build b-1/)).toBeInTheDocument();

    const leadSelect = within(
      screen.getByTestId('millforge-mapping-lead-role'),
    ).getByRole('combobox') as HTMLSelectElement;
    const workerSelect = within(
      screen.getByTestId('millforge-mapping-worker-role'),
    ).getByRole('combobox') as HTMLSelectElement;
    expect(leadSelect.value).toBe('lead');
    expect(workerSelect.value).toBe('w1');

    fireEvent.click(screen.getByTestId('millforge-inject'));
    await waitFor(() =>
      expect(mocks.api.injectMillforge).toHaveBeenCalledWith({
        build_id: 'b-1',
        team: 'alpha',
        mapping: { 'lead-role': 'lead', 'worker-role': 'w1' },
        create_workers: [],
        core_skill: false,
        apply_soul: true,
        overwrite: false,
      }),
    );
    expect(mocks.api.preflightMillforgeSouls).toHaveBeenCalledWith('b-1', {
      'lead-role': 'lead',
      'worker-role': 'w1',
    });
    expect(await screen.findByText('注入结果（全部成功）')).toBeInTheDocument();
    await waitFor(() => expect(onInjected).toHaveBeenCalled());
  });

  it('SOUL 冲突时先确认覆盖，overwrite=true 再注入', async () => {
    mocks.api.preflightMillforgeSouls.mockResolvedValue({
      build_id: 'b-1',
      conflict_count: 1,
      targets: [
        {
          worker: 'lead',
          role_id: 'lead-role',
          state: 'differs',
          prev_len: 10,
          prev_head: 'old soul',
        },
      ],
    });
    renderDialog();
    await screen.findByText('模板包（pack）');
    fireEvent.click(await waitForCompileReady());
    await screen.findByText(/LEAD SOUL/);
    fireEvent.click(screen.getByTestId('millforge-inject'));

    expect(await screen.findByText('现有 SOUL 将被覆盖')).toBeInTheDocument();
    expect(mocks.api.injectMillforge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '覆盖并注入' }));
    await waitFor(() =>
      expect(mocks.api.injectMillforge).toHaveBeenCalledWith(
        expect.objectContaining({ overwrite: true }),
      ),
    );
  });

  it('源/包端点 404/405 → 注入 tab 显示控制器不支持', async () => {
    mocks.api.getMillforgeSource.mockRejectedValue(
      new ApiError('API Error 404: not found', 404, '/millforge/source'),
    );
    mocks.api.getMillforgePacks.mockRejectedValue(
      new ApiError('API Error 405: method not allowed', 405, '/millforge/packs'),
    );
    renderDialog();
    const notices = await screen.findAllByText(/控制器不支持该千锻端点/);
    expect(notices.length).toBeGreaterThan(0);
  });

  it('编译 422 → 展示分段错误', async () => {
    mocks.api.compileMillforge.mockRejectedValue(
      new ApiError(
        'API Error 422: {"stage":"compile","error":"boom","stderr_tail":"line1"}',
        422,
        '/millforge/compile',
      ),
    );
    renderDialog();
    await screen.findByText('模板包（pack）');
    fireEvent.click(await waitForCompileReady());
    expect(await screen.findByText('编译失败')).toBeInTheDocument();
    expect(screen.getByText(/编译失败（compile）：boom/)).toBeInTheDocument();
  });
});

describe('MillforgeDialog · 自定义团队 tab', () => {
  it('生成提示词 / 校验 JSON / 编译 team_json 调用正确 API', async () => {
    mocks.api.promptMillforge.mockResolvedValue({
      ok: true,
      pack: 'millforge',
      prompt: 'PROMPT-BODY',
    });
    mocks.api.parseMillforgeTeamJson.mockResolvedValue({
      ok: true,
      team: { name: 'custom', roles: [{ role: 'a' }, { role: 'b' }] },
    });
    renderDialog();
    switchTab('自定义团队');

    fireEvent.change(screen.getByLabelText('最痛的 3 个问题（必填）'), {
      target: { value: '联调环境不稳' },
    });
    await waitFor(() => expect(screen.getByTestId('millforge-prompt')).toBeEnabled());
    fireEvent.click(screen.getByTestId('millforge-prompt'));
    await waitFor(() =>
      expect(mocks.api.promptMillforge).toHaveBeenCalledWith('millforge', {
        members: '',
        task_types: '',
        runtime: '',
        pains: '联调环境不稳',
        team_name: '',
      }),
    );
    expect(await screen.findByText('PROMPT-BODY')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('LLM 返回的 JSON'), {
      target: { value: '{"name":"custom"}' },
    });
    fireEvent.click(screen.getByTestId('millforge-parse'));
    await waitFor(() =>
      expect(mocks.api.parseMillforgeTeamJson).toHaveBeenCalledWith('millforge', '{"name":"custom"}'),
    );
    expect(await screen.findByText(/校验通过（2 个角色）/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('millforge-compile-json'));
    await waitFor(() =>
      expect(mocks.api.compileMillforge).toHaveBeenCalledWith(
        expect.objectContaining({ team: 'alpha', team_json: { name: 'custom', roles: [{ role: 'a' }, { role: 'b' }] } }),
      ),
    );
  });

  it('校验失败逐项列出字段错误', async () => {
    mocks.api.parseMillforgeTeamJson.mockResolvedValue({
      ok: false,
      errors: [{ path: 'roles.0.role', message: 'required' }],
    });
    renderDialog();
    switchTab('自定义团队');
    fireEvent.change(screen.getByLabelText('LLM 返回的 JSON'), { target: { value: '{}' } });
    await waitFor(() => expect(screen.getByTestId('millforge-parse')).toBeEnabled());
    fireEvent.click(screen.getByTestId('millforge-parse'));
    expect(await screen.findByText('roles.0.role — required')).toBeInTheDocument();
  });
});

describe('MillforgeDialog · 注入历史 tab', () => {
  it('历史列表展示状态/团队/时间', async () => {
    mocks.api.getMillforgeInjections.mockResolvedValue({
      injections: [
        {
          id: 'i-1',
          at: '2026-11-08T10:00:00Z',
          build_id: 'b-1',
          team: 'alpha',
          partial: true,
          souls: [{ role_id: 'r', status: 'ok' }],
          created: [],
          core_skill: { status: 'skipped' },
        },
      ],
    });
    renderDialog();
    switchTab('注入历史');
    expect(await screen.findByText('部分失败')).toBeInTheDocument();
    expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
    expect(screen.getByText('1/1')).toBeInTheDocument();
  });

  it('历史读取失败可重试（其它 tab 不受影响）', async () => {
    mocks.api.getMillforgeInjections.mockRejectedValueOnce(
      new ApiError('API Error 502: down', 502, '/millforge/injections'),
    );
    renderDialog();
    switchTab('注入历史');
    expect(await screen.findByText(/注入历史读取失败/)).toBeInTheDocument();
    mocks.api.getMillforgeInjections.mockResolvedValue({
      injections: [],
    });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无注入记录')).toBeInTheDocument();
    switchTab('注入');
    expect(screen.getByTestId('millforge-compile')).toBeInTheDocument();
  });
});

describe('MillforgeDialog · 模块更新 tab', () => {
  it('团队面默认当前团队；状态标签 + 版本下拉 + 单按钮安装', async () => {
    renderDialog();
    switchTab('模块更新');

    const row = await screen.findByTestId('module-row-teamharness');
    expect(within(row).getByText('可更新')).toBeInTheDocument();
    const versionSelect = within(row).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(versionSelect.options).map((option) => option.value)).toEqual([
      '0.2.0',
      '0.1.0',
    ]);
    expect(versionSelect.value).toBe('0.2.0');

    const latestRow = screen.getByTestId('module-row-up-to-date-mod');
    expect(within(latestRow).getByText('已是最新')).toBeInTheDocument();

    const inconsistentRow = screen.getByTestId('module-row-inconsistent-mod');
    expect(within(inconsistentRow).getByText('版本不一致')).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: /更新/ }));
    expect(await screen.findByText(/更新 teamharness/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }));
    await waitFor(() =>
      expect(mocks.api.installTeamModule).toHaveBeenCalledWith('alpha', 'teamharness', {
        module: 'teamharness',
        source: 'github',
        channel: 'beta',
        version: '0.2.0',
      }),
    );
  });

  it('index 404 → 显示控制器不支持，其它 tab 仍可用', async () => {
    mocks.api.getMillforgeIndex.mockRejectedValue(
      new ApiError('API Error 404: not found', 404, '/millforge/index'),
    );
    renderDialog();
    switchTab('模块更新');
    expect(await screen.findByText('控制器不支持', {}, { timeout: 4000 })).toBeInTheDocument();
    switchTab('注入');
    expect(screen.getByTestId('millforge-compile')).toBeInTheDocument();
  });

  it('非管理员只看不装', async () => {
    renderDialog({ canInstall: false });
    switchTab('模块更新');
    const row = await screen.findByTestId('module-row-teamharness');
    expect(within(row).getByRole('button', { name: /更新/ })).toBeDisabled();
    expect(within(row).getByText('更新需要管理员（L1）权限。')).toBeInTheDocument();
  });

  it('千锻模块面不渲染 CodingCLI 桥（索引与已装列表都过滤）', async () => {
    renderDialog();
    switchTab('模块更新');

    // 其它模块照常渲染，说明列表本身是好的（不是整表为空导致假阴性）。
    expect(await screen.findByTestId('module-row-teamharness')).toBeInTheDocument();

    expect(
      screen.queryByTestId('module-row-qwenpaw-qwencode-bridge'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('qwenpaw-qwencode-bridge')).not.toBeInTheDocument();
    expect(screen.queryByText('qwen-code-bridge')).not.toBeInTheDocument();
    // 已装但被过滤的模块也不该落进「索引外的已安装模块（只读）」兜底列表。
    expect(screen.queryByText('索引外的已安装模块（只读）')).not.toBeInTheDocument();
  });
});
