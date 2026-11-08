import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-error';
import type { WorkerResponse } from '@/lib/agentteams-api';
import type { WorkerMcpResult } from '@/lib/worker-mcp';

const mocks = vi.hoisted(() => ({
  fetchWorkerMcp: vi.fn(),
  updateWorker: vi.fn(),
}));

vi.mock('@/lib/agentteams-api', () => ({
  fetchWorkerMcp: (...args: unknown[]) => mocks.fetchWorkerMcp(...args),
  agentteamsApi: {
    updateWorker: (...args: unknown[]) => mocks.updateWorker(...args),
  },
}));

// 登记目录（McpSelector 的候选来源）：transport 原样流式名，selector 投影成 http。
vi.mock('@/hooks/use-agentteams-mcps', () => ({
  useMcpServers: () => ({
    data: [
      {
        name: 'github',
        url: 'https://gateway/mcp-servers/github/mcp',
        transport: 'streaminghttp',
      },
    ],
  }),
}));

import { WorkerMcpPanel } from './worker-mcp-panel';

function makeWorker(mcpServers: Array<{ name: string; url: string; transport: string }> = []): WorkerResponse {
  return {
    name: 'worker-a',
    state: 'Running',
    runtime: 'qwenpaw',
    mcpServers,
  } as unknown as WorkerResponse;
}

function renderPanel(
  mcpServers: Array<{ name: string; url: string; transport: string }> = [],
  options: { canEdit?: boolean; onChanged?: () => void } = {},
) {
  return render(
    <TooltipProvider>
      <WorkerMcpPanel
        worker={makeWorker(mcpServers)}
        workerName="worker-a"
        workerTeam="team-alpha"
        canEdit={options.canEdit ?? false}
        onChanged={options.onChanged}
      />
    </TooltipProvider>,
  );
}

// Radix 的 Popper/Tooltip 在 jsdom 里需要 ResizeObserver（同 model-selector 测试）。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  mocks.fetchWorkerMcp.mockReset();
  mocks.updateWorker.mockReset();
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe('WorkerMcpPanel', () => {
  it('merges declared and self-registered rows by name, with self-registered winning conflicts', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({
      available: true,
      items: [
        { name: 'ctx7', url: 'https://self.example/sse', transport: 'sse' },
        { name: 'teamharness', url: 'http://teamharness.example/mcp', transport: 'http' },
      ],
    } satisfies WorkerMcpResult);

    renderPanel([
      { name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' },
      { name: 'declared-only', url: 'http://declared-only.example/mcp', transport: 'http' },
    ]);

    expect(await screen.findByText('https://self.example/sse')).toBeInTheDocument();
    // 同 name 只一行：声明侧的旧 endpoint 不再出现（自注册优先）。
    expect(screen.queryByText('http://declared.example/mcp')).not.toBeInTheDocument();
    expect(screen.getByText('http://declared-only.example/mcp')).toBeInTheDocument();
    expect(screen.getAllByText('声明')).toHaveLength(2);
    expect(screen.getAllByText('注册')).toHaveLength(2);
    expect(screen.getByText('teamharness')).toBeInTheDocument();
  });

  it('shows env/header key names only, with values masked', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({
      available: true,
      items: [
        {
          name: 'teamharness',
          transport: 'stdio',
          command: '~/bin/mcp-server',
          args: ['--flag'],
          envKeys: ['AGENTTEAMS_WORKER_MATRIX_TOKEN'],
          headerKeys: ['Authorization'],
        },
      ],
    } satisfies WorkerMcpResult);

    renderPanel();

    expect(await screen.findByText(/env: AGENTTEAMS_WORKER_MATRIX_TOKEN=\*\*\*/)).toBeInTheDocument();
    expect(screen.getByText(/headers: Authorization=\*\*\*/)).toBeInTheDocument();
    expect(screen.getByText('~/bin/mcp-server --flag')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret');
  });

  it('degrades to one info line on 404 while still showing declared servers', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({
      available: false,
      reason: 'controller_too_old',
      items: [],
    } satisfies WorkerMcpResult);

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }]);

    expect(await screen.findByText(/需升级 controller/)).toBeInTheDocument();
    expect(screen.getByText('ctx7')).toBeInTheDocument();
    expect(screen.getByText('http://declared.example/mcp')).toBeInTheDocument();
    expect(screen.queryByText('无 MCP server')).not.toBeInTheDocument();
  });

  it('degrades to one info line on 403 without hiding declared servers', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({
      available: false,
      reason: 'forbidden',
      items: [],
    } satisfies WorkerMcpResult);

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }]);

    expect(await screen.findByText(/无权限读取 worker 自注册 MCP/)).toBeInTheDocument();
    expect(screen.getByText('ctx7')).toBeInTheDocument();
  });

  it('shows the empty state only when both paths are genuinely empty', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({
      available: true,
      items: [],
    } satisfies WorkerMcpResult);

    renderPanel();

    expect(await screen.findByText('无 MCP server')).toBeInTheDocument();
  });

  it('keeps declared servers visible when the self-registered read fails', async () => {
    mocks.fetchWorkerMcp.mockRejectedValue(new Error('boom'));

    renderPanel([{ name: 'declared-only', url: 'http://declared-only.example/mcp', transport: 'http' }]);

    expect(await screen.findByText(/读取 worker 自注册 MCP 失败/)).toBeInTheDocument();
    expect(screen.getByText('declared-only')).toBeInTheDocument();
    expect(screen.queryByText('无 MCP server')).not.toBeInTheDocument();
  });

  it('labels declared rows editable and self-registered-only rows read-only', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({
      available: true,
      items: [{ name: 'mm-bridge', url: 'http://self.example/mcp', transport: 'http' }],
    } satisfies WorkerMcpResult);

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], {
      canEdit: true,
    });

    expect(await screen.findByText('运行时注册，只读')).toBeInTheDocument();
    expect(screen.getByText('可在上方编辑')).toBeInTheDocument();
    // 编辑入口只有 declared 区顶部那一个，自注册行没有单独入口。
    expect(screen.getAllByRole('button', { name: '编辑分配' })).toHaveLength(1);
  });

  it('hides the edit entry without update permission', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] } satisfies WorkerMcpResult);

    renderPanel([], { canEdit: false });

    expect(await screen.findByText('无 MCP server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑分配' })).not.toBeInTheDocument();
  });

  it('opens the edit dialog with the declared allocation preloaded', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] } satisfies WorkerMcpResult);

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], {
      canEdit: true,
    });

    fireEvent.click(await screen.findByRole('button', { name: '编辑分配' }));

    expect(await screen.findByText('MCP 分配 — worker-a')).toBeInTheDocument();
    // McpSelector 的 value 初值 = declared（选择器触发按钮上显示已选数量）。
    expect(screen.getByRole('button', { name: /1 个 MCP 服务器已选择/ })).toBeInTheDocument();
    expect(screen.getByText(/所属团队：team-alpha/)).toBeInTheDocument();
  });

  it('saves only mcpServers and refreshes both views on success', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] } satisfies WorkerMcpResult);
    mocks.updateWorker.mockResolvedValue({ name: 'worker-a' });
    const onChanged = vi.fn();

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], {
      canEdit: true,
      onChanged,
    });

    fireEvent.click(await screen.findByRole('button', { name: '编辑分配' }));
    fireEvent.click(await screen.findByRole('button', { name: /1 个 MCP 服务器已选择/ }));
    fireEvent.click(await screen.findByRole('button', { name: /github/ }));
    fireEvent.click(screen.getByRole('button', { name: '确定 (2 个)' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.updateWorker).toHaveBeenCalledWith('worker-a', {
        mcpServers: [
          { name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' },
          { name: 'github', url: 'https://gateway/mcp-servers/github/mcp', transport: 'http' },
        ],
      }),
    );
    // 只提交 mcpServers：整表单字段一个都不带（exact match 已断言）。
    expect(Object.keys(mocks.updateWorker.mock.calls[0][1] as Record<string, unknown>)).toEqual([
      'mcpServers',
    ]);
    await waitFor(() => expect(screen.queryByText('MCP 分配 — worker-a')).not.toBeInTheDocument());
    expect(onChanged).toHaveBeenCalledTimes(1);
    // 合并视图刷新：初次挂载 1 次 + 保存成功后 1 次。
    await waitFor(() => expect(mocks.fetchWorkerMcp).toHaveBeenCalledTimes(2));
  });

  it('keeps the dialog open and shows the backend message when save fails', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] } satisfies WorkerMcpResult);
    mocks.updateWorker.mockRejectedValue(
      new ApiError('forbidden: 需要团队管理员才能修改 mcpServers', 403, 'PUT /workers/worker-a'),
    );
    const onChanged = vi.fn();

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], {
      canEdit: true,
      onChanged,
    });

    fireEvent.click(await screen.findByRole('button', { name: '编辑分配' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存' }));

    expect(
      await screen.findByText(/forbidden: 需要团队管理员才能修改 mcpServers/),
    ).toBeInTheDocument();
    expect(screen.getByText('MCP 分配 — worker-a')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(mocks.fetchWorkerMcp).toHaveBeenCalledTimes(1);
  });

  it('does not write anything when the dialog is cancelled', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] } satisfies WorkerMcpResult);

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], {
      canEdit: true,
    });

    fireEvent.click(await screen.findByRole('button', { name: '编辑分配' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByText('MCP 分配 — worker-a')).not.toBeInTheDocument());
    expect(mocks.updateWorker).not.toHaveBeenCalled();
  });
});
