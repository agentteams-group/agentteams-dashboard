import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkerResponse } from '@/lib/agentteams-api';

const mounts = vi.hoisted(() => ({
  runtime: 0,
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

vi.mock('@/lib/worker-detail', () => ({
  fetchWorkerDetail: vi.fn(async () => worker),
  invalidateWorkerDetail: vi.fn(),
}));
vi.mock('@/hooks/use-now-tick', () => ({ useNowTick: () => 0 }));
vi.mock('@/hooks/use-agentteams-worker-skills', () => ({
  useWorkerSkills: () => ({ data: [] }),
  useUploadWorkerSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('./worker-runtime-config-panel', () => ({
  WorkerRuntimeConfigPanel: () => { mounts.runtime += 1; return <div>runtime-panel</div>; },
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
  runtime: 'qwenpaw',
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
  mcpServers: [{ name: 'ctx7', url: 'http://mcp', transport: 'http' }],
} as unknown as WorkerResponse;

function renderDrawer(userLevel = 3) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkerDrawer
        worker={worker}
        onOpenChange={vi.fn()}
        modelOptions={[]}
        userLevel={userLevel}
        onChanged={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.keys(mounts).forEach((key) => { mounts[key as keyof typeof mounts] = 0; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/observability')) {
      return new Response(JSON.stringify({ error: '仅管理员' }), { status: 403 });
    }
    if (url.includes('/loops/status')) {
      return new Response('{}', { status: 404 });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('renders MCP and checkpoints sections', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    expect(screen.getByText('ctx7')).toBeInTheDocument();
    expect(screen.getByText('checkpoints-card')).toBeInTheDocument();
  });

  it('lazily mounts resource panels only when expanded', () => {
    renderDrawer();
    expect(screen.queryByText('tools-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('channels-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('workspace-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('plugins-panel')).not.toBeInTheDocument();
    expect(mounts.mcp).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    expect(mounts.mcp).toBe(1);
    expect(screen.getByText('ctx7')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '工具' }));
    expect(screen.getByText('tools-panel')).toBeInTheDocument();
    expect(mounts.tools).toBe(1);
    expect(screen.queryByText('channels-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '频道' }));
    expect(screen.getByText('channels-panel')).toBeInTheDocument();
    expect(screen.getByText('tools-panel')).toBeInTheDocument();
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
