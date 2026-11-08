/**
 * 项目「子会话」卡单测。
 *
 * 契约：
 *   · /spawns 404/405 → 整块隐藏（不留空壳、不报错）
 *   · 树按 root_session_id 递归，节点显示状态/时间/白名单/子会话数，caret 可折叠
 *   · 节点「消息」懒加载：404 空态、403 无权限、其余失败可重试
 *   · 消息正文超 6 行折叠，「展开」看全文
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import type { ProjectSpawnsResponse, SpawnMessagesResponse } from '@/lib/agentteams-projects-api';

const mockSpawns = vi.fn();
const mockMessages = vi.fn();

vi.mock('@/lib/agentteams-projects-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentteams-projects-api')>()),
  getProjectSpawns: (...args: unknown[]) => mockSpawns(...args),
  getSpawnMessages: (...args: unknown[]) => mockMessages(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  mockSpawns.mockReset();
  mockMessages.mockReset();
});

import { ProjectSpawnsPanel } from './project-spawns-panel';

const spawnsResponse: ProjectSpawnsResponse = {
  project_id: 'p1',
  workers: [
    {
      worker: 'alice',
      spawns: [
        {
          session_id: 'sub-root',
          name: '实现登录',
          status: 'running',
          last_activity: '2026-11-08T10:20:00Z',
          created_at: '2026-11-08T09:00:00Z',
          root_session_id: null,
          allowedTools: ['read_file'],
          skills: ['deploy'],
        },
        {
          session_id: 'sub-child',
          name: '补测试',
          status: 'done',
          root_session_id: 'sub-root',
        },
      ],
    },
  ],
};

function renderPanel() {
  return render(<ProjectSpawnsPanel projectId="p1" teamId="team-a" />);
}

describe('ProjectSpawnsPanel', () => {
  it('hides the whole block when the spawn endpoint is absent (404/405)', async () => {
    mockSpawns.mockRejectedValue(new ApiError('not found', 404, '/spawns'));
    const { container } = renderPanel();

    await waitFor(() => expect(mockSpawns).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders the recursive tree with status, whitelists and child count', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    expect(screen.getByText('补测试')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('工具白名单')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('技能白名单')).toBeInTheDocument();
    expect(screen.getByText('deploy')).toBeInTheDocument();
    expect(screen.getByText('1 子会话')).toBeInTheDocument();
    expect(mockSpawns).toHaveBeenCalledWith('p1', 'team-a', expect.anything());
  });

  it('collapses and expands a node subtree with the caret', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    renderPanel();

    await waitFor(() => expect(screen.getByText('补测试')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /展开或收起 实现登录/ }));
    expect(screen.queryByText('补测试')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /展开或收起 实现登录/ }));
    expect(screen.getByText('补测试')).toBeInTheDocument();
  });

  it('treats a 404 message stream as the empty state', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    mockMessages.mockRejectedValue(new ApiError('missing', 404, '/messages'));
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /消息/ })[0]);

    await waitFor(() => expect(screen.getByText('暂无消息')).toBeInTheDocument());
    expect(mockMessages).toHaveBeenCalledWith('p1', 'sub-root', expect.anything());
  });

  it('shows the forbidden state on 403', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    mockMessages.mockRejectedValue(new ApiError('denied', 403, '/messages'));
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /消息/ })[0]);

    await waitFor(() => expect(screen.getByText('无权限查看')).toBeInTheDocument());
  });

  it('retries a failed message load and renders has_more', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    const ok: SpawnMessagesResponse = {
      session_id: 'sub-root',
      messages: [
        { seq: 1, role: 'user', name: 'alice', content: '请实现登录', created_at: '2026-11-08T09:01:00Z' },
      ],
      has_more: true,
    };
    mockMessages
      .mockRejectedValueOnce(new ApiError('boom', 500, '/messages'))
      .mockResolvedValueOnce(ok);
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /消息/ })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /加载失败 · 重试/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /加载失败 · 重试/ }));
    await waitFor(() => expect(screen.getByText('请实现登录')).toBeInTheDocument());
    expect(screen.getByText('仅显示最近 1 条')).toBeInTheDocument();
  });

  it('folds long message content behind 展开 and reveals it on click', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    const lines = Array.from({ length: 8 }, (_, i) => `line-${i + 1}`);
    mockMessages.mockResolvedValue({
      session_id: 'sub-root',
      messages: [{ seq: 1, role: 'assistant', content: lines.join('\n') }],
      has_more: false,
    } satisfies SpawnMessagesResponse);
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /消息/ })[0]);

    await waitFor(() => expect(screen.getByText(/line-1/)).toBeInTheDocument());
    expect(screen.getByText(/line-1/).textContent).not.toContain('line-7');
    expect(screen.getByText(/line-1/).textContent).not.toContain('line-8');

    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByText(/line-1/).textContent).toContain('line-8');
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();
  });
});
