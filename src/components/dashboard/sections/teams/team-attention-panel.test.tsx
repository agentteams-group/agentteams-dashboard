/**
 * 团队待决策面板单测（controller /teams/{name}/attention 读端，上游 #1503）。
 *
 * 契约：
 *   · 打开时加载收件箱，显示未处理计数与超时计数
 *   · 绑定了房间的项深链到聊天；只有项目绑定的项深链到任务看板
 *   · 未通知 / 通知缺口在行内标出，便于区分「没人被通知」和「通知了没回复」
 *   · 截断时提示还有更多匹配项
 *   · 404（旧 Controller）→ 升级占位，不渲染错误
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import type { TeamAttentionResponse } from '@/lib/agentteams-api';

const mockAttention = vi.fn();

vi.mock('@/lib/agentteams-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentteams-api')>()),
  agentteamsApi: {
    getTeamAttention: (...args: unknown[]) => mockAttention(...args),
  },
}));

vi.mock('@/lib/open-chat-room', () => ({
  openChatRoom: vi.fn(),
}));

const setPendingProjectKey = vi.fn();
const setActiveSection = vi.fn();

vi.mock('@/lib/hitl-inbox', () => ({
  useHitlInboxStore: {
    getState: () => ({ setPendingProjectKey }),
  },
}));

vi.mock('@/lib/section-store', () => ({
  useSectionStore: {
    getState: () => ({ setActiveSection }),
  },
}));

afterEach(cleanup);
beforeEach(() => {
  mockAttention.mockReset();
  setPendingProjectKey.mockReset();
  setActiveSection.mockReset();
});

import { TeamAttentionPanel } from './team-attention-panel';
import { openChatRoom } from '@/lib/open-chat-room';

const response: TeamAttentionResponse = {
  team_id: 'biz-team',
  count: 3,
  truncated: false,
  items: [
    {
      taskId: 't1',
      eventId: '$evt-1',
      teamId: 'biz-team',
      projectId: 'p1',
      kind: 'approval',
      question: '是否允许部署到生产？',
      options: [
        { id: 'yes', label: '允许', description: '' },
        { id: 'no', label: '拒绝', description: '' },
      ],
      requestedAt: '2026-11-04T09:00:00Z',
      timeoutAt: '2026-11-04T09:30:00Z',
      overdue: true,
      resolved: false,
      resolvedVia: null,
      resolvedBy: null,
      resolvedAt: null,
      resolution: null,
      freeform: false,
      notified: null,
      roomId: '!task-t1:example.org',
      url: '/projects/p1/tasks/t1',
    },
    {
      taskId: 't2',
      eventId: null,
      teamId: 'biz-team',
      projectId: 'p2',
      kind: 'decision',
      question: '选哪个方案？',
      options: [],
      requestedAt: '2026-11-04T09:10:00Z',
      timeoutAt: '2099-01-01T00:00:00Z',
      overdue: false,
      resolved: false,
      resolvedVia: null,
      resolvedBy: null,
      resolvedAt: null,
      resolution: null,
      freeform: true,
      notified: {
        sent: true,
        roomAccepted: true,
        channelAccepted: null,
        recipients: [],
        gaps: ['dm'],
        at: '2026-11-04T09:10:01Z',
      },
      roomId: '',
      url: '/projects/p2/tasks/t2',
    },
    {
      taskId: 't3',
      eventId: '$evt-3',
      teamId: 'biz-team',
      projectId: 'p3',
      kind: 'escalation',
      question: '升级处理？',
      options: [],
      requestedAt: '2026-11-04T08:00:00Z',
      timeoutAt: '2026-11-04T08:30:00Z',
      overdue: false,
      resolved: true,
      resolvedVia: 'matrix',
      resolvedBy: 'alice',
      resolvedAt: '2026-11-04T08:20:00Z',
      resolution: 'approved',
      freeform: false,
      notified: null,
      roomId: '',
      url: '/projects/p3/tasks/t3',
    },
  ],
};

function renderPanel(defaultOpen = true) {
  return render(<TeamAttentionPanel teamName="biz-team" defaultOpen={defaultOpen} />);
}

describe('TeamAttentionPanel', () => {
  it('loads on open and shows unresolved + overdue counts', async () => {
    mockAttention.mockResolvedValue(response);
    renderPanel();

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(screen.getByText(/超时 1/)).toBeInTheDocument();
    expect(mockAttention).toHaveBeenCalledWith('biz-team');
  });

  it('renders rows with kind, question, and notification gaps', async () => {
    mockAttention.mockResolvedValue(response);
    renderPanel();

    await waitFor(() => expect(screen.getByText(/是否允许部署到生产/)).toBeInTheDocument());
    expect(screen.getByText(/2 个选项/)).toBeInTheDocument();
    expect(screen.getByText(/自由回答/)).toBeInTheDocument();
    expect(screen.getByText(/已超时/)).toBeInTheDocument();
    expect(screen.getByText(/已处理/)).toBeInTheDocument();
    expect(screen.getByText(/通知缺口 1/)).toBeInTheDocument();
  });

  it('deep-links a room-bound row into chat', async () => {
    mockAttention.mockResolvedValue(response);
    renderPanel();

    const row = await screen.findByRole('button', { name: /是否允许部署到生产/ });
    fireEvent.click(row);
    expect(openChatRoom).toHaveBeenCalledWith('!task-t1:example.org');
    expect(setPendingProjectKey).not.toHaveBeenCalled();
  });

  it('deep-links a project-only row into the task board', async () => {
    mockAttention.mockResolvedValue(response);
    renderPanel();

    const row = await screen.findByRole('button', { name: /选哪个方案/ });
    fireEvent.click(row);
    expect(openChatRoom).not.toHaveBeenCalled();
    expect(setPendingProjectKey).toHaveBeenCalledWith({ id: 'p2', team: 'biz-team' });
    expect(setActiveSection).toHaveBeenCalledWith('tasks');
  });

  it('notes truncation when the controller cut the list', async () => {
    mockAttention.mockResolvedValue({ ...response, truncated: true });
    renderPanel();

    await waitFor(() => expect(screen.getByText(/还有更多匹配项/)).toBeInTheDocument());
  });

  it('renders the upgrade placeholder for 404 instead of an error', async () => {
    mockAttention.mockRejectedValue(new ApiError('not found', 404, '/teams/biz-team/attention'));
    renderPanel();

    await waitFor(() => expect(screen.getByText(/上游 #1503/)).toBeInTheDocument());
  });

  it('loads lazily when collapsed and triggers on expand', async () => {
    mockAttention.mockResolvedValue(response);
    renderPanel(false);

    expect(mockAttention).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /团队待决策/ }));
    await waitFor(() => expect(mockAttention).toHaveBeenCalledTimes(1));
  });
});
