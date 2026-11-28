import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-error';
import type { WorkerResponse } from '@/lib/agentteams-api';

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
  options: { canEdit?: boolean; onChanged?: () => void; runtime?: WorkerResponse["runtime"] } = {},
) {
  return render(
    <TooltipProvider>
      <WorkerMcpPanel
        worker={{ ...makeWorker(mcpServers), runtime: options.runtime ?? "qwenpaw" }}
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
  it.each(['qwenpaw', 'hermes', 'deepseek-harness', 'claudecode', 'codex'] as const)(
    'uses Core assignments without a native registry lookup for %s', async (runtime) => {
      mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [{ name: 'native-only' }] });
      renderPanel([{ name: 'github-long-service-name', url: 'https://gateway/private', transport: 'http' }], { runtime, canEdit: true });
      expect(screen.getByTitle('github-long-service-name')).toHaveClass('truncate');
      expect(screen.getByRole('combobox', { name: '添加 MCP 服务' })).toBeVisible();
      expect(screen.getByRole('button', { name: '移除 github-long-service-name' })).toBeVisible();
      expect(screen.getByRole('button', { name: '审批策略' })).toBeVisible();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mocks.fetchWorkerMcp).not.toHaveBeenCalled();
      expect(screen.queryByText('native-only')).not.toBeInTheDocument();
      expect(screen.queryByText(/https?:\/\//)).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('shows an empty assignment list without waiting for a running Agent', () => {
    renderPanel();
    expect(screen.getByText('尚未分配 MCP 服务')).toBeVisible();
    expect(mocks.fetchWorkerMcp).not.toHaveBeenCalled();
  });

  it('hides the edit entry without update permission', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] });

    renderPanel([], { canEdit: false });

    expect(await screen.findByText('尚未分配 MCP 服务')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '添加 MCP 服务' })).not.toBeInTheDocument();
  });

  it('shows inline allocation without opening a dialog', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] });
    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], { canEdit: true });
    expect(screen.getByRole('combobox', { name: '添加 MCP 服务' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除 ctx7' })).toBeInTheDocument();
  });

  it('saves only mcpServers and refreshes Core detail on success', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] });
    mocks.updateWorker.mockResolvedValue({ name: 'worker-a' });
    const onChanged = vi.fn();

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], {
      canEdit: true,
      onChanged,
    });

    fireEvent.focus(screen.getByRole('combobox', { name: '添加 MCP 服务' }));
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'github' }));

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
    expect(mocks.fetchWorkerMcp).not.toHaveBeenCalled();
  });

  it.each(['qwenpaw', 'hermes', 'deepseek-harness', 'claudecode', 'codex'] as const)('saves the standard wildcard approval for %s', async (runtime) => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] });
    const server = { name: 'github', url: 'http://gateway/mcp/github', transport: 'http' };
    renderPanel([server], { canEdit: true, runtime });
    fireEvent.click(await screen.findByRole('button', { name: '审批策略' }));
    fireEvent.change(screen.getByLabelText('github · 全部工具审批'), { target: { value: 'ask' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.updateWorker).toHaveBeenCalledWith('worker-a', {
      mcpServers: [{ ...server, approvals: { tools: '*', mode: 'ask' } }],
    }));
  });

  it('keeps the dialog open and shows the backend message when save fails', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] });
    mocks.updateWorker.mockRejectedValue(
      new ApiError('forbidden: 需要团队管理员才能修改 mcpServers', 403, 'PUT /workers/worker-a'),
    );
    const onChanged = vi.fn();

    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], {
      canEdit: true,
      onChanged,
    });

    fireEvent.click(await screen.findByRole('button', { name: '移除 ctx7' }));

    expect(
      await screen.findByText(/forbidden: 需要团队管理员才能修改 mcpServers/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除 ctx7' })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(mocks.fetchWorkerMcp).not.toHaveBeenCalled();
  });

  it('removes a declared allocation directly from the list', async () => {
    mocks.fetchWorkerMcp.mockResolvedValue({ available: true, items: [] });
    mocks.updateWorker.mockResolvedValue({});
    renderPanel([{ name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' }], { canEdit: true });
    fireEvent.click(screen.getByRole('button', { name: '移除 ctx7' }));
    await waitFor(() => expect(mocks.updateWorker).toHaveBeenCalledWith('worker-a', { mcpServers: [] }));
  });
});
