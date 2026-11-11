import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ManagerResponse } from '@/lib/agentteams-api';
import { ApiError } from '@/lib/api-error';

const mocks = vi.hoisted(() => ({
  updateManagerAsync: vi.fn(),
  restartManager: vi.fn(),
  updateManagerModel: vi.fn(),
  getManagerLogs: vi.fn(),
  fetchManagerFull: vi.fn(),
  invalidateManagerDetail: vi.fn(),
}));

vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useUpdateManager: () => ({
    mutate: vi.fn(),
    mutateAsync: mocks.updateManagerAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/agentteams-api', () => ({
  agentteamsApi: {
    restartManager: mocks.restartManager,
    updateManagerModel: mocks.updateManagerModel,
    getManagerLogs: mocks.getManagerLogs,
  },
}));

vi.mock('@/lib/manager-detail', () => ({
  fetchManagerFull: mocks.fetchManagerFull,
  invalidateManagerDetail: mocks.invalidateManagerDetail,
}));

vi.mock('@/hooks/use-skill-center', () => ({
  useSkills: () => ({
    data: {
      skills: [
        { name: 'sk-catalog', description: '目录技能', source: 'custom', version: '1', fileCount: 1, createdAt: '' },
      ],
      total: 1,
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { ManagerDrawer } from './manager-drawer';
import { TooltipProvider } from '@/components/ui/tooltip';

const baseManager = {
  name: 'manager-a',
  phase: 'Running',
  state: 'Running',
  model: 'team-chat',
  modelProvider: 'apig-team',
  runtime: 'qwenpaw',
  image: 'registry.example.com/agentteams/manager:2.2.2',
  matrixUserID: '@manager-a:hs',
  roomID: '!dm-manager-a:hs',
  version: '2.2.2',
  message: 'ready',
  welcomeSent: true,
} as unknown as ManagerResponse;

function managerWith(overrides: Partial<ManagerResponse> = {}): ManagerResponse {
  return { ...baseManager, ...overrides };
}

function renderDrawer(
  manager: ManagerResponse = managerWith({
    soul: 'old soul',
    agents: 'rules',
    skills: ['old-skill'],
    mcpServers: [{ name: 'ctx7', url: 'http://mcp', transport: 'http' }],
    env: { A: '1' },
    config: { heartbeatInterval: '15m' },
  }),
  options: { userLevel?: number; onDm?: (_mxid: string, _roomId?: string) => void; onEdit?: (_m: ManagerResponse) => void } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ManagerDrawer
          manager={manager}
          modelOptions={[]}
          userLevel={options.userLevel ?? 3}
          onOpenChange={vi.fn()}
          onChanged={vi.fn()}
          onEdit={options.onEdit}
          onDm={options.onDm}
        />
      </TooltipProvider>
    </QueryClientProvider>,
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
  mocks.updateManagerAsync.mockResolvedValue({});
  mocks.restartManager.mockResolvedValue({ success: true });
  mocks.updateManagerModel.mockResolvedValue({});
  mocks.getManagerLogs.mockResolvedValue([]);
  mocks.fetchManagerFull.mockResolvedValue(
    managerWith({
      soul: 'old soul',
      agents: 'rules',
      skills: ['old-skill'],
      mcpServers: [{ name: 'ctx7', url: 'http://mcp', transport: 'http' }],
      env: { A: '1' },
      config: { heartbeatInterval: '15m' },
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ManagerDrawer', () => {
  it('renders the sheet header, status card and config summaries', async () => {
    renderDrawer();

    expect(screen.getByTestId('manager-drawer')).toBeInTheDocument();
    expect(screen.getByText('manager-a')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText('State')).toBeInTheDocument();
    expect(screen.getByText('个人房间')).toBeInTheDocument();

    // full spec read back after mount → summaries stop saying「加载中…」
    expect(await screen.findByText('8 字符')).toBeInTheDocument();
    expect(screen.getByText('5 字符')).toBeInTheDocument();
    expect(screen.getByText('old-skill')).toBeInTheDocument();
    expect(screen.getByText('ctx7')).toBeInTheDocument();
    expect(screen.getByText('1 项')).toBeInTheDocument();
  });

  it('shows 休眠 for a running Manager and 唤醒 for a sleeping one', () => {
    const { unmount } = renderDrawer(managerWith({ state: 'Running' }));
    expect(screen.getByRole('button', { name: '休眠' })).toBeInTheDocument();
    unmount();

    renderDrawer(managerWith({ state: 'Sleeping' }));
    expect(screen.getByRole('button', { name: '唤醒' })).toBeInTheDocument();
  });

  it('sends the desired state on 休眠 / 唤醒', async () => {
    const { unmount } = renderDrawer(managerWith({ state: 'Running' }));
    fireEvent.click(screen.getByRole('button', { name: '休眠' }));
    await waitFor(() =>
      expect(mocks.updateManagerAsync).toHaveBeenCalledWith({
        name: 'manager-a',
        data: { state: 'Sleeping' },
      }),
    );
    unmount();

    mocks.updateManagerAsync.mockClear();
    renderDrawer(managerWith({ state: 'Sleeping' }));
    fireEvent.click(screen.getByRole('button', { name: '唤醒' }));
    await waitFor(() =>
      expect(mocks.updateManagerAsync).toHaveBeenCalledWith({
        name: 'manager-a',
        data: { state: 'Running' },
      }),
    );
  });

  it('restarts only after the confirmation dialog', async () => {
    renderDrawer();
    expect(mocks.restartManager).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重启' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('重启 Manager manager-a？')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '重启' }));
    await waitFor(() => expect(mocks.restartManager).toHaveBeenCalledWith('manager-a'));
  });

  it('saves the model through updateManagerModel', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));

    const input = await screen.findByLabelText('请求模型别名');
    fireEvent.change(input, { target: { value: 'team-chat-v2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.updateManagerModel).toHaveBeenCalledWith('manager-a', 'team-chat-v2', undefined),
    );
  });

  it('edits SOUL.md after confirmation', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'SOUL.md' }));

    const textarea = await screen.findByLabelText('SOUL.md 内容');
    expect(textarea).toHaveValue('old soul');
    fireEvent.change(textarea, { target: { value: 'new soul' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: '确认保存' }));

    await waitFor(() =>
      expect(mocks.updateManagerAsync).toHaveBeenCalledWith({
        name: 'manager-a',
        data: { soul: 'new soul' },
      }),
    );
  });

  it('refuses to clear an existing document with an empty draft', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'AGENTS.md' }));

    const textarea = await screen.findByLabelText('AGENTS.md 内容');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('空内容无法清除既有值');
    expect(mocks.updateManagerAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('saves skills as a full replacement', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Skills' }));

    const input = await screen.findByLabelText('添加技能名');
    fireEvent.change(input, { target: { value: 'new-skill' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.updateManagerAsync).toHaveBeenCalledWith({
        name: 'manager-a',
        data: { skills: ['old-skill', 'new-skill'] },
      }),
    );
  });

  it('validates MCP rows before saving', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'MCP Servers' }));

    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.change(screen.getByLabelText('MCP name 2'), { target: { value: 'only-name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('存在未完成行');
    expect(mocks.updateManagerAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('MCP url 2'), { target: { value: 'http://other-mcp' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.updateManagerAsync).toHaveBeenCalledWith({
        name: 'manager-a',
        data: {
          mcpServers: [
            { name: 'ctx7', url: 'http://mcp', transport: 'http' },
            { name: 'only-name', url: 'http://other-mcp' },
          ],
        },
      }),
    );
  });

  it('saves env and flags it as not applied when the controller does not echo it', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Env' }));

    fireEvent.change(screen.getByLabelText('变量值 1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.updateManagerAsync).toHaveBeenCalledWith({
        name: 'manager-a',
        data: { env: { A: '2' } },
      }),
    );
    expect(await screen.findByText(/Env 未生效/)).toBeInTheDocument();
  });

  it('saves the Manager-only config as a whole object', async () => {
    renderDrawer();
    const heartbeat = await screen.findByLabelText('心跳间隔');
    expect(heartbeat).toHaveValue('15m');

    fireEvent.change(heartbeat, { target: { value: '30m' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() =>
      expect(mocks.updateManagerAsync).toHaveBeenCalledWith({
        name: 'manager-a',
        data: { config: { heartbeatInterval: '30m', workerIdleTimeout: '', notifyChannel: '' } },
      }),
    );
  });

  it('surfaces a readable hint when the controller rejects the operation (403)', async () => {
    mocks.restartManager.mockRejectedValueOnce(new ApiError('denied', 403, '/restart'));
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: '重启' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '重启' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('L1 管理员权限');
  });

  it('is read-only without L1 (dashboard level 3)', async () => {
    renderDrawer(managerWith({ soul: 'x' }), { userLevel: 2 });

    expect(screen.queryByRole('button', { name: '休眠' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重启' })).not.toBeInTheDocument();
    expect(screen.getByText(/只读：编辑 Manager 配置需要 L1 管理员权限/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型配置' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /容器日志/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('心跳间隔')).toBeDisabled();
  });

  it('shows the DM entry only with an MXID and forwards the target', async () => {
    const onDm = vi.fn();
    const { unmount } = renderDrawer(managerWith({ matrixUserID: '', roomID: '' }), { onDm });
    expect(screen.queryByRole('button', { name: '私聊' })).not.toBeInTheDocument();
    unmount();

    renderDrawer(managerWith(), { onDm });
    fireEvent.click(screen.getByRole('button', { name: '私聊' }));
    expect(onDm).toHaveBeenCalledWith('@manager-a:hs', '!dm-manager-a:hs');
  });

  it('exposes the edit entry to the list-page dialog', () => {
    const onEdit = vi.fn();
    renderDrawer(managerWith(), { onEdit });
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ name: 'manager-a' }));
  });
});

describe('ManagerDrawer container logs', () => {
  it('loads on demand (no polling) and renders lines', async () => {
    mocks.getManagerLogs.mockResolvedValue([
      { timestamp: '2026-11-08T10:00:00Z', level: 'info', component: 'manager-a', message: 'boot ok' },
    ]);
    renderDrawer();

    expect(mocks.getManagerLogs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /容器日志/ }));

    expect(await screen.findByText(/boot ok/)).toBeInTheDocument();
    expect(mocks.getManagerLogs).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /容器日志/ }));
    expect(await screen.findByText('（无日志行）')).toBeInTheDocument();
  });

  it('renders a retryable failure state and retries on demand', async () => {
    mocks.getManagerLogs.mockRejectedValueOnce(new ApiError('docker exploded', 502, '/logs'));
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: /容器日志/ }));
    expect(await screen.findByText('加载失败 · 重试')).toBeInTheDocument();

    mocks.getManagerLogs.mockResolvedValueOnce([
      { timestamp: '2026-11-08T10:00:00Z', level: 'info', component: 'manager-a', message: 'recovered' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '加载失败 · 重试' }));
    expect(await screen.findByText(/recovered/)).toBeInTheDocument();
  });

  it('renders the missing-container state for a 404', async () => {
    mocks.getManagerLogs.mockRejectedValue(new ApiError('not found', 404, '/logs'));
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: /容器日志/ }));
    expect(await screen.findByText(/该 Manager 暂无容器日志/)).toBeInTheDocument();
  });

  it('refreshes manually through the refresh button', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: '刷新日志' }));

    expect(await screen.findByText('（无日志行）')).toBeInTheDocument();
    expect(mocks.getManagerLogs).toHaveBeenCalledTimes(1);
  });
});
