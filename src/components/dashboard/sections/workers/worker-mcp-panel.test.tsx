import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { WorkerResponse } from '@/lib/agentteams-api';
import type { WorkerMcpResult } from '@/lib/worker-mcp';

const mocks = vi.hoisted(() => ({
  fetchWorkerMcp: vi.fn(),
}));

vi.mock('@/lib/agentteams-api', () => ({
  fetchWorkerMcp: (...args: unknown[]) => mocks.fetchWorkerMcp(...args),
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
) {
  return render(<WorkerMcpPanel worker={makeWorker(mcpServers)} />);
}

beforeEach(() => {
  mocks.fetchWorkerMcp.mockReset();
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
});
