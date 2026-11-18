import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

// 整改③ 新契约：WorkerDrawer = EntityInspector（真实，头部 + 动作 + 分区按钮 +
// 按钮下方只读详情）+ EntitySectionDialogs（共享弹窗路由）。
// 三个 section 弹窗按 kind 互斥——抽屉只承载 worker 实体，全部 stub：
// stub 断言 open / worker / initialTab / chrome 接线，并带一个输入框标记「可编辑」。
const dialogState = vi.hoisted(() => ({
  open: false,
  workerName: null as string | null,
  initialTab: undefined as string | undefined,
  chrome: undefined as string | undefined,
  lastOpenChange: null as ((_open: boolean) => void) | null,
}));

vi.mock('../team-agents/worker-detail-dialog', () => ({
  WorkerDetailDialog: ({
    open,
    onOpenChange,
    worker,
    initialTab,
    chrome,
  }: {
    open: boolean;
    onOpenChange: (_open: boolean) => void;
    worker: WorkerResponse | null;
    initialTab?: string;
    chrome?: 'full' | 'section';
  }) => {
    dialogState.open = open;
    dialogState.workerName = worker?.name ?? null;
    dialogState.initialTab = initialTab;
    dialogState.chrome = chrome;
    dialogState.lastOpenChange = onOpenChange;
    if (!open || !worker) return null;
    return (
      <div role="dialog" aria-label={`stub-detail:${worker.name}:${initialTab ?? 'basic'}`}>
        <input aria-label="stub-editable-input" />
        <button type="button" aria-label="stub-close" onClick={() => onOpenChange(false)}>
          stub-close
        </button>
      </div>
    );
  },
}));
vi.mock('../team-agents/team-detail-dialog', () => ({
  TeamDetailDialog: () => null,
}));
vi.mock('../team-agents/manager-detail-dialog', () => ({
  ManagerDetailDialog: () => null,
}));
vi.mock('@/hooks/use-agentteams-mutations', () => {
  // mutate(vars, { onSuccess })：立即触发成功回调，覆盖「删除成功 → 关弹窗/抽屉」链路。
  const hook = () => ({
    mutate: vi.fn((_vars: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.()),
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

import { WorkerDrawer } from './worker-drawer';

const teamAlpha = {
  name: 'alpha',
  teamName: 'Alpha',
  phase: 'Active',
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
  workerNames: ['lead', 'worker-a'],
  workerExposedPorts: {},
} as unknown as TeamResponse;

function workerFixture(name: string): WorkerResponse {
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
    lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  } as unknown as WorkerResponse;
}

const workerA = workerFixture('worker-a');
const workerList = [workerA, workerFixture('lead')];

interface DrawerOptions {
  userLevel?: number;
  teams?: TeamResponse[];
  workers?: WorkerResponse[];
  onDeleted?: () => void;
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDrawer(target: WorkerResponse, options: DrawerOptions = {}) {
  const client = makeClient();
  const onOpenChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WorkerDrawer
          worker={target}
          onOpenChange={onOpenChange}
          modelOptions={[]}
          userLevel={options.userLevel ?? 3}
          teams={options.teams ?? [teamAlpha]}
          workers={options.workers ?? workerList}
          onChanged={vi.fn()}
          onDeleted={options.onDeleted}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange };
}

function SwitchableDrawer({ worker }: { worker: WorkerResponse }) {
  return (
    <WorkerDrawer
      worker={worker}
      onOpenChange={vi.fn()}
      modelOptions={[]}
      userLevel={3}
      teams={[teamAlpha]}
      workers={workerList}
      onChanged={vi.fn()}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  dialogState.open = false;
  dialogState.workerName = null;
  dialogState.initialTab = undefined;
  dialogState.chrome = undefined;
  dialogState.lastOpenChange = null;
});

afterEach(cleanup);

describe('WorkerDrawer（③：Inspector + 分区弹窗共享接线）', () => {
  it('抽屉 = Inspector：标题 / 头部 / 角色徽标 / 6 个分区按钮 / 下方只读详情 / 快动作', () => {
    renderDrawer(workerA);
    const drawer = screen.getByRole('dialog', { name: 'Worker 详情' });
    expect(within(drawer).getByRole('heading', { name: 'worker-a' })).toBeInTheDocument();
    expect(within(drawer).getByText('成员')).toBeInTheDocument();
    for (const title of ['基础配置', 'MCP', '技能', '高级配置', '工作区文件', '会话']) {
      expect(within(drawer).getByRole('button', { name: title })).toBeInTheDocument();
    }
    // ② 分区按钮下方常驻只读详情（与只读详情弹窗同一实现 WorkerDetailSummary）。
    expect(within(drawer).getByText('只读详情')).toBeInTheDocument();
    expect(within(drawer).getByText('容器状态')).toBeInTheDocument();
    // 容器状态值 / 模型值与头部 chips 重复出现（阶段徽标「运行中」、头部模型）——用计数断言。
    expect(within(drawer).getAllByText('running').length).toBeGreaterThanOrEqual(1);
    expect(within(drawer).getAllByText('worker-a-model').length).toBeGreaterThanOrEqual(1);
    // 快动作：休眠 / 重启 / 删除（L1）。
    expect(within(drawer).getByRole('button', { name: /休眠/ })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /重启/ })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /删除/ })).toBeInTheDocument();
    // 旧全量编辑面不再在抽屉内（无 tab 列表 / 无内联配置面板）。
    expect(within(drawer).queryByRole('tablist')).toBeNull();
  });

  it('点分区按钮 → 可编辑分区弹窗（共享路由：worker 实体 + initialTab + chrome=section）', async () => {
    renderDrawer(workerA);
    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    const dialog = await screen.findByRole('dialog', { name: 'stub-detail:worker-a:mcp' });
    // 可编辑标记：弹窗内含输入框。
    expect(within(dialog).getByRole('textbox', { name: 'stub-editable-input' })).toBeInTheDocument();
    expect(dialogState.workerName).toBe('worker-a');
    expect(dialogState.initialTab).toBe('mcp');
    expect(dialogState.chrome).toBe('section');
    // 关闭分区弹窗 → 抽屉仍在。
    fireEvent.click(within(dialog).getByRole('button', { name: 'stub-close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /stub-detail/ })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Worker 详情' })).toBeInTheDocument();
  });

  it('未传 teams / workers 时保持兼容（homeTeam=null，成员口径为空）', () => {
    const utils = render(<WorkerDrawer worker={workerA} onOpenChange={vi.fn()} modelOptions={[]} userLevel={3} />);
    const drawer = screen.getByRole('dialog', { name: 'Worker 详情' });
    expect(within(drawer).getByRole('heading', { name: 'worker-a' })).toBeInTheDocument();
    expect(within(drawer).getByText('成员')).toBeInTheDocument();
    utils.unmount();
  });

  it('切换 worker（重开抽屉）→ 分区弹窗状态复位', async () => {
    const client = makeClient();
    const utils = render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SwitchableDrawer worker={workerA} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    await screen.findByRole('dialog', { name: 'stub-detail:worker-a:mcp' });
    const workerB = { ...workerA, name: 'worker-b' };
    utils.rerender(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SwitchableDrawer worker={workerB} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /stub-detail/ })).toBeNull());
    const drawer = screen.getByRole('dialog', { name: 'Worker 详情' });
    expect(within(drawer).getByRole('heading', { name: 'worker-b' })).toBeInTheDocument();
  });

  it('删除（L1）：确认 → 关分区弹窗 + 关抽屉 + onDeleted 回调', async () => {
    const onDeleted = vi.fn();
    // 状态化父组件：onOpenChange(false) → 清 worker（模拟列表页真实行为，抽屉随之卸载）。
    function Parent() {
      const [target, setTarget] = useState<WorkerResponse | null>(workerA);
      return (
        <WorkerDrawer
          worker={target}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          modelOptions={[]}
          userLevel={3}
          teams={[teamAlpha]}
          workers={workerList}
          onChanged={vi.fn()}
          onDeleted={onDeleted}
        />
      );
    }
    render(
      <QueryClientProvider client={makeClient()}>
        <TooltipProvider>
          <Parent />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /删除/ }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Worker 详情' })).toBeNull());
  });

  it('非 L1：无删除入口', () => {
    renderDrawer(workerA, { userLevel: 2 });
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });
});
