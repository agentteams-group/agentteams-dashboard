/**
 * 项目信号流面板单测（controller /signal-events 读端，上游 #1433）。
 *
 * 契约：
 *   · 打开时加载首页，事件按 id 去重、按时间升序保留、渲染时新→旧
 *   · `next_cursor` 存在时提供「加载更早」，翻页追加旧事件
 *   · 404（旧 Controller）→ 升级占位，不渲染错误
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import type { ProjectSignalEventsResponse } from '@/lib/agentteams-projects-api';

const mockSignal = vi.fn();

vi.mock('@/lib/agentteams-projects-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentteams-projects-api')>()),
  getProjectSignalEvents: (...args: unknown[]) => mockSignal(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  mockSignal.mockReset();
});

import { ProjectSignalEventsPanel } from './project-signal-events-panel';

function renderPanel() {
  return render(<ProjectSignalEventsPanel projectId="p1" teamId="team-a" />);
}

const firstPage: ProjectSignalEventsResponse = {
  project_id: 'p1',
  count: 2,
  next_cursor: 'cursor-1',
  events: [
    {
      event_id: 'e1',
      task_id: '',
      event_type: 'SIG_PAUSE',
      is_signal: true,
      source_event: { origin: 'controller' },
      occurred_at: '2026-11-04T09:00:00Z',
      payload: { source: 'user' },
    },
    {
      event_id: 'e2',
      task_id: 't1',
      event_type: 'SIG_ESCALATE',
      is_signal: true,
      source_event: { origin: 'teamharness', request_id: 'r1' },
      occurred_at: '2026-11-04T09:05:00Z',
    },
  ],
};

const olderPage: ProjectSignalEventsResponse = {
  project_id: 'p1',
  count: 1,
  events: [
    {
      event_id: 'e0',
      task_id: '',
      event_type: 'SIG_RESUME',
      is_signal: false,
      source_event: { origin: 'controller' },
      occurred_at: '2026-11-04T08:55:00Z',
    },
  ],
};

describe('ProjectSignalEventsPanel', () => {
  it('loads the latest page on open and renders newest first', async () => {
    mockSignal.mockResolvedValue(firstPage);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /信号/ }));

    await waitFor(() => expect(screen.getByText('SIG_PAUSE')).toBeInTheDocument());
    expect(screen.getByText('SIG_ESCALATE')).toBeInTheDocument();
    expect(mockSignal).toHaveBeenCalledWith('p1', 'team-a', { limit: 50 });
    // 新→旧：SIG_ESCALATE(09:05) 在 SIG_PAUSE(09:00) 之前。
    const labels = screen.getAllByText(/^SIG_/).map((el) => el.textContent);
    expect(labels).toEqual(['SIG_ESCALATE', 'SIG_PAUSE']);
  });

  it('loads older events with the retained cursor', async () => {
    mockSignal.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(olderPage);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /信号/ }));
    await waitFor(() => expect(screen.getByText('SIG_PAUSE')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '加载更早的信号' }));

    await waitFor(() => expect(screen.getByText('SIG_RESUME')).toBeInTheDocument());
    expect(mockSignal).toHaveBeenLastCalledWith('p1', 'team-a', {
      limit: 50,
      cursor: 'cursor-1',
    });
  });

  it('renders the upgrade placeholder on 404', async () => {
    mockSignal.mockRejectedValue(new ApiError('not found', 404, 'signal-events'));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /信号/ }));
    await waitFor(() =>
      expect(screen.getByText(/信号端点未部署/)).toBeInTheDocument(),
    );
  });
});
