import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { WorkerResponse } from '@/lib/agentteams-api';
import { WorkerDetailDialog } from './worker-detail-dialog';

// 弹窗内嵌真实 WorkerDetailPanel（R1 分区直出的承载）——只 mock 面板的
// 数据钩子与 mutations，fetch 统一 stub 成 404（异步失败被面板 catch）。
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
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({
    data: [
      { name: 'w1', runtime: 'qwenpaw' } as unknown as WorkerResponse,
    ],
  }),
}));

function workerFixture(name: string, team: string): WorkerResponse {
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

function renderDialog(props: { initialTab?: string } = {}) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <WorkerDetailDialog
          open
          onOpenChange={onOpenChange}
          worker={workerFixture('w1', 'alpha')}
          modelOptions={[]}
          userLevel={3}
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe('WorkerDetailDialog · R1 分区直出', () => {
  beforeEach(() => {
    // 面板内的原始 fetch（worker 详情 / loop 状态 / observability）统一
    // 失败回落——弹窗内容来自 prop 快照，不依赖网络。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('chrome=section：只渲染 basic 分区正文，无动作条与垂直 tab 列表', async () => {
    renderDialog({ initialTab: 'basic' });
    const dialog = await screen.findByRole('dialog', { name: 'w1 · 基础配置' });
    // 动作条（休眠 / 重启 / 私聊 / 删除）全部隐藏。
    for (const name of [/休眠/, /重启/, /私聊/, /删除/]) {
      expect(within(dialog).queryByRole('button', { name })).toBeNull();
    }
    // 垂直 tab 列表隐藏。
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    // basic 分区内容直出（模型 / 镜像 / 编辑入口）。
    expect(within(dialog).getByText('模型 ID')).toBeInTheDocument();
    expect(within(dialog).getByText('w1-model')).toBeInTheDocument();
    expect(within(dialog).getByText('镜像')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '编辑基础配置' })).toBeInTheDocument();
  });

  it('initialTab 无效 → 回落首个分区（分区直出，不出现头/动作条/tab 列表）', async () => {
    renderDialog({ initialTab: 'bogus' });
    const dialog = await screen.findByRole('dialog', { name: 'w1 · 基础配置' });
    expect(within(dialog).getByRole('button', { name: '编辑基础配置' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /休眠/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /重启/ })).toBeNull();
  });

  it('initialTab 缺省 → 同样回落首个分区（避免空白弹窗，且不重复头部/分区列表）', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'w1 · 基础配置' });
    expect(within(dialog).getByRole('button', { name: '编辑基础配置' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('tablist')).toBeNull();
  });
});
