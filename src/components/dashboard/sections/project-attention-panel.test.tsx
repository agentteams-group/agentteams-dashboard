/**
 * 项目待决策面板单测（controller /attention 读端，上游 #1434）。
 *
 * 契约：
 *   · 打开时加载未处理项，显示未处理计数与超时计数
 *   · 绑定了任务房间的项可深链到聊天；未绑定的只读
 *   · 404（旧 Controller）→ 升级占位，不渲染错误
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import type { ProjectAttentionResponse } from '@/lib/agentteams-projects-api';

const mockAttention = vi.fn();

vi.mock('@/lib/agentteams-projects-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentteams-projects-api')>()),
  getProjectAttention: (...args: unknown[]) => mockAttention(...args),
}));

vi.mock('@/lib/open-chat-room', () => ({
  openChatRoom: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  mockAttention.mockReset();
});

import { ProjectAttentionPanel } from './project-attention-panel';
import { openChatRoom } from '@/lib/open-chat-room';

function renderPanel(now: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectAttentionPanel projectId="p1" teamId="team-a" now={now} />
    </QueryClientProvider>,
  );
}

const response: ProjectAttentionResponse = {
  project_id: 'p1',
  count: 2,
  items: [
    {
      task_id: 't1',
      task_title: '实现登录',
      task_status: 'in_progress',
      room_id: '!task-t1:example.org',
      kind: 'approval',
      question: '是否允许部署到生产？',
      attempt: 1,
      requested_at: '2026-11-04T09:00:00Z',
      resolved: false,
      expires_at: '2026-11-04T09:30:00Z',
    },
    {
      task_id: 't2',
      task_title: '生成报告',
      task_status: 'in_progress',
      kind: 'decision',
      question: '选哪个方案？',
      attempt: 0,
      requested_at: '2026-11-04T09:10:00Z',
      resolved: false,
    },
  ],
};

describe('ProjectAttentionPanel', () => {
  it('loads on open and shows unresolved + overdue counts', async () => {
    mockAttention.mockResolvedValue(response);
    renderPanel(Date.parse('2026-11-04T09:45:00Z'));

    fireEvent.click(screen.getByRole('button', { name: /待决策/ }));

    await waitFor(() => expect(screen.getByText('是否允许部署到生产？')).toBeInTheDocument());
    expect(screen.getByText('选哪个方案？')).toBeInTheDocument();
    expect(mockAttention).toHaveBeenCalledWith('p1', 'team-a');
    // t1 已过 expires_at，t2 无 deadline：徽标与行内各出现一次。
    expect(screen.getByText('超时 1')).toBeInTheDocument();
    expect(screen.getByText(/已超时/)).toBeInTheDocument();
  });

  it('deep-links only room-bound items', async () => {
    mockAttention.mockResolvedValue(response);
    renderPanel(Date.parse('2026-11-04T09:20:00Z'));

    fireEvent.click(screen.getByRole('button', { name: /待决策/ }));
    await waitFor(() => expect(screen.getByText('是否允许部署到生产？')).toBeInTheDocument());

    fireEvent.click(screen.getByText('是否允许部署到生产？').closest('button') as HTMLElement);
    expect(openChatRoom).toHaveBeenCalledWith('!task-t1:example.org');
    // t2 没有 room_id，是只读行，点击不会触发深链。
    expect(screen.getByText('选哪个方案？').closest('button')).toBeNull();
  });

  it('renders the upgrade placeholder on 404', async () => {
    mockAttention.mockRejectedValue(new ApiError('not found', 404, 'attention'));
    renderPanel(Date.now());

    fireEvent.click(screen.getByRole('button', { name: /待决策/ }));
    await waitFor(() =>
      expect(screen.getByText(/待决策端点未部署/)).toBeInTheDocument(),
    );
  });
});
