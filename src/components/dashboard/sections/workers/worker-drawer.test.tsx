import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkerResponse } from '@/lib/agentteams-api';

const mounts = vi.hoisted(() => ({
  surface: {} as Record<string, number>,
  qwenpaw: 0,
  mcp: 0,
  tools: 0,
  skills: 0,
  channels: 0,
  approval: 0,
  coding: 0,
  workspace: 0,
  env: 0,
  llm: 0,
  plugins: 0,
  checkpoints: 0,
}));

const detailState = vi.hoisted(() => ({ worker: null as unknown }));

vi.mock('@/lib/worker-detail', () => ({
  fetchWorkerDetail: vi.fn(async () => detailState.worker),
  invalidateWorkerDetail: vi.fn(),
}));
vi.mock('@/hooks/use-now-tick', () => ({ useNowTick: () => 0 }));
vi.mock('@/hooks/use-agentteams-worker-skills', () => ({
  useWorkerSkills: () => ({ data: [] }),
  useUploadWorkerSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('./worker-runtime-config-surface', () => ({
  WorkerRuntimeConfigSurface: ({ bucket = 'config' }: { bucket?: string }) => {
    mounts.surface[bucket] = (mounts.surface[bucket] ?? 0) + 1;
    return <div>{`surface-${bucket}`}</div>;
  },
}));
vi.mock('./qwenpaw-runtime-config-panel', () => ({
  QwenpawRuntimeConfigPanel: ({
    workerName,
    canWrite,
  }: {
    workerName: string;
    canWrite?: boolean;
  }) => {
    mounts.qwenpaw += 1;
    return <div>{`qwenpaw-runtime-${workerName}-${canWrite ? 'rw' : 'ro'}`}</div>;
  },
}));
vi.mock('./worker-tools-panel', () => ({
  WorkerToolsPanel: () => { mounts.tools += 1; return <div>tools-panel</div>; },
}));
vi.mock('./worker-mcp-panel', () => ({
  WorkerMcpPanel: ({ worker }: { worker: { mcpServers?: Array<{ name: string }> } }) => {
    mounts.mcp += 1;
    return <div>{(worker.mcpServers ?? []).map((server) => server.name).join(',')}</div>;
  },
}));
vi.mock('./worker-skill-assign', () => ({
  WorkerSkillAssign: () => { mounts.skills += 1; return <div>skills-panel</div>; },
}));
vi.mock('./worker-skill-upload-dialog', () => ({
  WorkerSkillUploadDialog: () => <div>upload-dialog</div>,
}));
vi.mock('./worker-channels-panel', () => ({
  WorkerChannelsPanel: () => { mounts.channels += 1; return <div>channels-panel</div>; },
}));
vi.mock('./worker-approval-control', () => ({
  WorkerApprovalControl: () => { mounts.approval += 1; return <div>approval-panel</div>; },
}));
vi.mock('./worker-coding-cli-panel', () => ({
  WorkerCodingCliPanel: () => { mounts.coding += 1; return <div>coding-panel</div>; },
}));
vi.mock('./worker-workspace-files-panel', () => ({
  WorkerWorkspaceFilesPanel: () => { mounts.workspace += 1; return <div>workspace-panel</div>; },
}));
vi.mock('./worker-env-card', () => ({
  WorkerEnvCard: () => { mounts.env += 1; return <div>env-panel</div>; },
}));
vi.mock('./worker-llm-tuning-panel', () => ({
  WorkerLlmTuningPanel: () => { mounts.llm += 1; return <div>llm-panel</div>; },
}));
vi.mock('./worker-plugins-card', () => ({
  WorkerPluginsCard: () => { mounts.plugins += 1; return <div>plugins-panel</div>; },
}));
vi.mock('./worker-checkpoints-card', () => ({
  WorkerCheckpointsCard: () => { mounts.checkpoints += 1; return <div>checkpoints-card</div>; },
}));

import { WorkerDrawer } from './worker-drawer';

const worker = {
  name: 'worker-a',
  phase: 'Running',
  state: 'Running',
  containerManaged: true,
  model: 'gpt-5',
  // CoPaw exposes every card (legacy migration card included) and routes the
  // capability cards through the runtime surface (non-QwenPaw path).
  runtime: 'copaw',
  image: 'img:latest',
  containerState: 'running',
  matrixUserID: '@worker-a:server',
  roomID: '!room:server',
  message: '',
  team: 'team-alpha',
  role: 'worker',
  agentStatus: 'idle',
  runningTaskCount: 0,
  lastActivityAt: new Date(Date.now() - 60_000).toISOString(),
  env: { A: '1', B: '2' },
  skills: ['s1'],
  mcpServers: [{ name: 'ctx7', url: 'http://mcp', transport: 'http' }],
} as unknown as WorkerResponse;

function renderDrawerFor(target: WorkerResponse, userLevel = 3) {
  detailState.worker = target;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkerDrawer
        worker={target}
        onOpenChange={vi.fn()}
        modelOptions={[]}
        userLevel={userLevel}
        onChanged={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function renderDrawer(userLevel = 3) {
  return renderDrawerFor(worker, userLevel);
}

beforeEach(() => {
  mounts.surface = {};
  mounts.qwenpaw = 0;
  mounts.mcp = 0;
  mounts.tools = 0;
  mounts.skills = 0;
  mounts.channels = 0;
  mounts.approval = 0;
  mounts.coding = 0;
  mounts.workspace = 0;
  mounts.env = 0;
  mounts.llm = 0;
  mounts.plugins = 0;
  mounts.checkpoints = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/observability')) {
      return new Response(JSON.stringify({ error: '仅管理员' }), { status: 403 });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CARDS: Array<{ title: string; content: string }> = [
  { title: '运行配置', content: 'surface-config' },
  { title: 'MCP', content: 'surface-mcp' },
  { title: '工具', content: 'surface-tools' },
  { title: '技能', content: 'surface-skills' },
  { title: '频道', content: 'surface-channels' },
  { title: '审批模式', content: 'surface-approval' },
  { title: 'Coding CLI', content: 'coding-panel' },
  { title: '工作区文件', content: 'workspace-panel' },
  { title: '环境变量与网关', content: 'env-panel' },
  { title: 'LLM 调优', content: 'llm-panel' },
  { title: 'Worker 插件', content: 'plugins-panel' },
  { title: '运行时升级', content: '将运行时从 CoPaw 升级到 QwenPaw。升级前请备份持久化数据，并避免在任务执行中切换。' },
  { title: '检查点', content: 'checkpoints-card' },
];

describe('WorkerDrawer', () => {
  it('renders header, status and model card', () => {
    renderDrawer();
    expect(screen.getByText('worker-a')).toBeInTheDocument();
    expect(screen.getByText('成员')).toBeInTheDocument();
    expect(screen.getByText('心跳')).toBeInTheDocument();
    expect(screen.getByText('最近活动')).toBeInTheDocument();
    expect(screen.getByText('在跑任务')).toBeInTheDocument();
    expect(screen.getByText('上次运行')).toBeInTheDocument();
    expect(screen.getByText('上次完成')).toBeInTheDocument();
    expect(screen.getAllByText('gpt-5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '编辑模型' })).toBeInTheDocument();
  });

  it('renders every resource card as an entry point (13 cards)', () => {
    renderDrawer();
    expect(screen.getAllByRole('button', { name: /./ })).not.toHaveLength(0);
    for (const card of CARDS) {
      expect(screen.getByRole('button', { name: card.title })).toBeInTheDocument();
    }
    expect(screen.getByText('2 个变量 · 模型 / MCP 网关探测')).toBeInTheDocument();
    // non-QwenPaw runtimes route the five capability cards through the surface
    expect(screen.getAllByText('CoPaw 配置面（surface 驱动）')).toHaveLength(5);
  });

  it('does not mount panel content until a card is opened', () => {
    renderDrawer();
    expect(screen.queryByText('checkpoints-card')).not.toBeInTheDocument();
    expect(mounts.checkpoints).toBe(0);
    expect(mounts.surface).toEqual({});
    expect(mounts.qwenpaw).toBe(0);
    expect(mounts.coding).toBe(0);
  });

  it('routes QwenPaw runtime config to the legacy panel instead of the surface', async () => {
    const qwenpawWorker = { ...worker, runtime: 'qwenpaw' } as unknown as WorkerResponse;
    renderDrawerFor(qwenpawWorker);

    fireEvent.click(screen.getByRole('button', { name: '运行配置' }));

    expect(await screen.findByText('qwenpaw-runtime-worker-a-rw')).toBeInTheDocument();
    expect(mounts.qwenpaw).toBe(1);
    expect(mounts.surface).toEqual({});
  });

  it('treats an empty runtime as non-QwenPaw (surface-driven, no fake fields)', async () => {
    const runtimeLessWorker = { ...worker, runtime: '' } as unknown as WorkerResponse;
    renderDrawerFor(runtimeLessWorker);

    fireEvent.click(screen.getByRole('button', { name: '运行配置' }));

    expect(await screen.findByText('surface-config')).toBeInTheDocument();
    expect(mounts.qwenpaw).toBe(0);
  });

  it.each(CARDS)('opens "$title" in a dialog and closes it', async ({ title, content }) => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: title }));

    expect(await screen.findByText(content)).toBeInTheDocument();
    // one modal, sized for the desktop panel
    const dialog = screen.getAllByRole('dialog').at(-1);
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    await waitFor(() => expect(screen.queryByText(content)).not.toBeInTheDocument());
  });

  it('closes the card dialog with Escape', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    expect(await screen.findByText('surface-mcp')).toBeInTheDocument();

    const dialog = screen.getAllByRole('dialog').at(-1);
    fireEvent.keyDown(dialog as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('surface-mcp')).not.toBeInTheDocument());
  });

  it('shows delete only for L1 (dashboard level 3)', () => {
    const { unmount } = renderDrawer(2);
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
    unmount();
    renderDrawer(3);
    expect(screen.getByRole('button', { name: /删除/ })).toBeInTheDocument();
  });

  it('shows Tracing only when observability is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/observability')) {
        return new Response(JSON.stringify({ enabled: true, publicUrl: 'https://langfuse.example.com' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
    renderDrawer(3);
    const link = await screen.findByRole('link', { name: /Tracing/ });
    expect(link).toHaveAttribute('href', 'https://langfuse.example.com');
  });
});
