import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { InteractiveTeamTopology } from './interactive-team-topology';

function worker(name: string, patch: Partial<WorkerResponse> = {}): WorkerResponse {
  return {
    name,
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: `${name}-model`,
    runtime: 'qwenpaw',
    image: 'img:latest',
    containerState: 'running',
    matrixUserID: `@${name}:server`,
    roomID: `!${name}:server`,
    message: '',
    team: 'alpha',
    role: 'worker',
    ...patch,
  } as unknown as WorkerResponse;
}

const alpha = {
  name: 'alpha',
  teamName: 'Alpha 小队',
  phase: 'Active',
  description: '',
  admin: { name: 'boss' },
  humanMembers: [],
  leaderName: 'lead',
  leaderHeartbeat: null,
  workerIdleTimeout: '720m',
  teamRoomID: '!team:server',
  leaderDMRoomID: '!dm:server',
  leaderReady: true,
  readyWorkers: 1,
  totalWorkers: 3,
  message: '',
  workerNames: ['lead', 'w1', 'critic1'],
  workerExposedPorts: {},
} as unknown as TeamResponse;

const workers = [
  worker('lead'),
  worker('w1', { phase: 'Sleeping' }),
  worker('critic1', { role: 'critic', phase: 'Failed' }),
  // 与 leader/admin 同名的 Manager 只作为团队 Manager 展示，不能抢 leader 行。
  worker('boss', { role: 'manager' }),
];

function renderTopology(patch: Partial<Parameters<typeof InteractiveTeamTopology>[0]> = {}) {
  const onOpenWorker = vi.fn();
  const onOpenTeamSettings = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InteractiveTeamTopology
        team={alpha}
        workers={workers}
        onOpenWorker={onOpenWorker}
        onOpenTeamSettings={onOpenTeamSettings}
        {...patch}
      />
    </QueryClientProvider>,
  );
  return { onOpenWorker, onOpenTeamSettings };
}

afterEach(cleanup);

describe('InteractiveTeamTopology · 头部', () => {
  it('shows the leader from the Worker list and the Manager from team.admin', () => {
    renderTopology();
    const header = screen.getByTestId('team-topology-header');
    expect(within(header).getByText(/Leader lead/)).toBeInTheDocument();
    expect(within(header).getByText('Manager · boss')).toBeInTheDocument();
    expect(within(header).queryByText(/Leader boss/)).toBeNull();
  });

  it('shows member counts, readiness, sleeping and abnormal totals', () => {
    renderTopology();
    const header = screen.getByTestId('team-topology-header');
    expect(within(header).getByText('3 名成员')).toBeInTheDocument();
    expect(within(header).getByText('就绪 1/3')).toBeInTheDocument();
    expect(within(header).getByText('休眠 1')).toBeInTheDocument();
    expect(within(header).getByText('异常 1')).toBeInTheDocument();
    expect(within(header).getByText('异常')).toBeInTheDocument(); // health badge
  });

  it('opens the existing team settings entry', () => {
    const { onOpenTeamSettings } = renderTopology();
    fireEvent.click(screen.getByRole('button', { name: '团队设置' }));
    expect(onOpenTeamSettings).toHaveBeenCalledWith(alpha);
  });
});

describe('InteractiveTeamTopology · 千锻入口', () => {
  it('渲染千锻入口卡与 logo（header 下、成员列表上）', () => {
    renderTopology({ onOpenMillforge: vi.fn() });
    const card = screen.getByTestId('millforge-card');
    expect(card).toHaveTextContent('千锻');
    expect(screen.getByTestId('millforge-logo')).toBeInTheDocument();
    // 位置：拓扑 header 之后、成员列表之前。
    const header = screen.getByTestId('team-topology-header');
    const list = screen.getByRole('list', { name: `${alpha.name} 成员` });
    expect(header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('点击 → onOpenMillforge(team)', () => {
    const onOpenMillforge = vi.fn();
    renderTopology({ onOpenMillforge, userLevel: 3 });
    fireEvent.click(screen.getByTestId('millforge-card'));
    expect(onOpenMillforge).toHaveBeenCalledWith(alpha);
  });

  it('非 L1（<3）禁用并 title 给原因；L1 可用', () => {
    const onOpenMillforge = vi.fn();
    const { unmount } = render(
      <InteractiveTeamTopology
        team={alpha}
        workers={workers}
        onOpenWorker={vi.fn()}
        onOpenTeamSettings={vi.fn()}
        onOpenMillforge={onOpenMillforge}
        userLevel={2}
      />,
    );
    const card = screen.getByTestId('millforge-card');
    expect(card).toBeDisabled();
    expect(card).toHaveAttribute('title', '千锻注入需管理员（L1）权限');
    unmount();

    // L1：卡片可用；此渲染会挂出成员行「拉起就绪」按钮（需要 QueryClient）。
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InteractiveTeamTopology
          team={alpha}
          workers={workers}
          onOpenWorker={vi.fn()}
          onOpenTeamSettings={vi.fn()}
          onOpenMillforge={onOpenMillforge}
          userLevel={3}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('millforge-card')).toBeEnabled();
  });

  it('未传 onOpenMillforge 时不渲染千锻入口（老调用方布局不变）', () => {
    renderTopology();
    expect(screen.queryByTestId('millforge-card')).toBeNull();
  });
});

describe('InteractiveTeamTopology · 成员行', () => {
  it('renders role badges and per-member status', () => {
    renderTopology();
    const lead = screen.getByText('lead').closest('[data-worker-name]') as HTMLElement;
    expect(lead).toHaveAttribute('data-role', 'leader');
    expect(within(lead).getByText('负责人')).toBeInTheDocument();
    expect(within(lead).getByRole('img', { name: 'Running' })).toBeInTheDocument();

    const critic = screen.getByText('critic1').closest('[data-worker-name]') as HTMLElement;
    expect(critic).toHaveAttribute('data-role', 'critic');
    expect(within(critic).getByText('评审')).toBeInTheDocument();
    expect(within(critic).getByText('异常')).toBeInTheDocument();
  });

  it('shows an optional session count when the projection provides one', () => {
    renderTopology({
      workers: [
        { ...worker('lead'), sessionCount: 2 } as WorkerResponse,
        worker('w1'),
      ],
      team: { ...alpha, workerNames: ['lead', 'w1'] } as TeamResponse,
    });
    expect(screen.getByText('2 会话')).toBeInTheDocument();
  });

  it('opens the matching worker on click', () => {
    const { onOpenWorker } = renderTopology();
    fireEvent.click(screen.getByText('w1').closest('[data-worker-name]') as HTMLElement);
    expect(onOpenWorker).toHaveBeenCalledTimes(1);
    expect(onOpenWorker).toHaveBeenCalledWith(expect.objectContaining({ name: 'w1' }));
  });

  it('opens the matching worker with Enter and Space', () => {
    const { onOpenWorker } = renderTopology();
    const row = screen.getByText('critic1').closest('[data-worker-name]') as HTMLElement;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpenWorker).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'critic1' }));
    fireEvent.keyDown(row, { key: ' ' });
    expect(onOpenWorker).toHaveBeenCalledTimes(2);
    expect(onOpenWorker).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'critic1' }));
  });
});

describe('InteractiveTeamTopology · 搜索', () => {
  it('keeps only matched members and reports the match count', () => {
    renderTopology({ searchQuery: 'w1' });
    expect(screen.getByRole('status')).toHaveTextContent('匹配 1 / 3 名成员');
    expect(screen.queryByText('lead')).toBeNull();
    expect(screen.getByText('w1')).toBeInTheDocument();
  });

  it('keeps the whole team when the team name matches', () => {
    renderTopology({ searchQuery: 'alpha' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('lead')).toBeInTheDocument();
    expect(screen.getByText('critic1')).toBeInTheDocument();
  });

  it('shows an empty result message when no member matches', () => {
    renderTopology({ searchQuery: 'nobody' });
    expect(screen.getByText('没有匹配的成员')).toBeInTheDocument();
  });
});
