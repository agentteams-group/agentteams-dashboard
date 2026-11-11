/**
 * 项目「子会话」卡单测。
 *
 * 契约：
 *   · /spawns 404/405 → 整块隐藏（不留空壳、不报错）
 *   · 整卡标题可折叠（默认展开），收起只隐藏正文，标题/计数/副标题/刷新保留
 *   · 每个 Worker 分组可独立折叠（默认展开），不影响整卡与其他分组
 *   · 树按 root_session_id 递归，节点显示状态/时间/白名单/子会话数，caret 可折叠
 *   · 节点「消息」懒加载：404 空态、403 无权限、其余失败可重试
 *   · 消息正文超 6 行折叠，「展开」看全文
 *   · 整卡 / 分组折叠支持 Enter、Space 键盘激活
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

const twoWorkerSpawns: ProjectSpawnsResponse = {
  project_id: 'p1',
  workers: [
    ...spawnsResponse.workers,
    {
      worker: 'bob',
      spawns: [
        {
          session_id: 'sub-bob',
          name: '巡检日志',
          status: 'idle',
          root_session_id: null,
        },
      ],
    },
  ],
};

function renderPanel() {
  return render(<ProjectSpawnsPanel projectId="p1" teamId="team-a" />);
}

function cardToggle() {
  return screen.getByRole('button', { name: '展开或收起子会话' });
}

function workerToggle(worker = 'alice') {
  return screen.getByRole('button', { name: `展开或收起 ${worker}` });
}

function controlledPanel(toggle: HTMLElement): HTMLElement {
  const id = toggle.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  const panel = document.getElementById(id as string);
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
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

  it('hides the whole block on 405 as well', async () => {
    mockSpawns.mockRejectedValue(new ApiError('method not allowed', 405, '/spawns'));
    const { container } = renderPanel();

    await waitFor(() => expect(mockSpawns).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('starts expanded and folds only the body when the header title is clicked', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    const toggle = cardToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(controlledPanel(toggle)).not.toHaveAttribute('hidden');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(controlledPanel(toggle)).toHaveAttribute('hidden');
    expect(screen.getByText('实现登录')).not.toBeVisible();
    // 收起只隐藏正文：副标题、计数与刷新按钮仍在
    expect(screen.getByText('按 Worker 分组 · 共 2 个')).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新子会话' })).toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('实现登录')).toBeVisible();
  });

  it('keeps refresh working while the card is collapsed without re-expanding it', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    const toggle = cardToggle();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(mockSpawns).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '刷新子会话' }));

    await waitFor(() => expect(mockSpawns).toHaveBeenCalledTimes(2));
    expect(mockSpawns).toHaveBeenLastCalledWith('p1', 'team-a', expect.anything());
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('collapses one worker group without collapsing the card or other groups', async () => {
    mockSpawns.mockResolvedValue(twoWorkerSpawns);
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    const toggle = workerToggle('alice');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(controlledPanel(toggle)).not.toHaveAttribute('hidden');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(controlledPanel(toggle)).toHaveAttribute('hidden');
    expect(screen.getByText('实现登录')).not.toBeVisible();
    expect(screen.getByText('补测试')).not.toBeVisible();
    // 整卡与其他分组不受影响
    expect(cardToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('巡检日志')).toBeVisible();

    fireEvent.click(toggle);
    expect(screen.getByText('实现登录')).toBeVisible();
  });

  it('keeps node-level collapse and message toggles working inside an open group', async () => {
    mockSpawns.mockResolvedValue(spawnsResponse);
    mockMessages.mockRejectedValue(new ApiError('missing', 404, '/messages'));
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    expect(cardToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(workerToggle()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: /展开或收起 实现登录/ }));
    expect(screen.queryByText('补测试')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /消息/ })[0]);
    await waitFor(() => expect(screen.getByText('暂无消息')).toBeInTheDocument());
    expect(mockMessages).toHaveBeenCalledWith('p1', 'sub-root', expect.anything());

    // 节点级操作不改变整卡/分组的展开态
    expect(cardToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(workerToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('activates the card and group toggles with Enter and Space', async () => {
    mockSpawns.mockResolvedValue(twoWorkerSpawns);
    renderPanel();

    await waitFor(() => expect(screen.getByText('实现登录')).toBeInTheDocument());
    const card = cardToggle();

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('实现登录')).not.toBeVisible();

    fireEvent.keyDown(card, { key: ' ' });
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('实现登录')).toBeVisible();

    const group = workerToggle('alice');
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('实现登录')).not.toBeVisible();

    fireEvent.keyDown(group, { key: ' ' });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('实现登录')).toBeVisible();
  });
});
