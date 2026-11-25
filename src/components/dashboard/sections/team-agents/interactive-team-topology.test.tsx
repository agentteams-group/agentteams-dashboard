import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { agentteamsApi, type TeamResponse, type WorkerResponse } from '@/lib/agentteams-api';
import { InteractiveTeamTopology } from './interactive-team-topology';

vi.mock('@/hooks/use-agentteams-humans', () => ({ useHumans: () => ({ data: [
  { name: 'boss', displayName: '团队管理员' },
  { name: 'reviewer', displayName: '评审成员', accessibleTeams: ['alpha'] },
] }) }));
vi.mock('../chat/views/worker-files-panel', () => ({ FilesBrowserPanel: ({ scope }: { scope: { team: string } }) => <div>团队文件目录：{scope.team}</div> }));

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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('edits description and adds only unassigned Agents inline without changing the leader', async () => {
  const update = vi.spyOn(agentteamsApi, 'updateTeam').mockImplementation(async (_name, data) => ({ ...alpha, ...data }) as TeamResponse);
  renderTopology({ userLevel: 3, allTeams: [alpha, { name: 'other', workerNames: ['referenced'] } as TeamResponse], workers: [
    ...workers, worker('free', { team: '' }), worker('assigned', { team: 'other' }), worker('referenced', { team: '' }),
  ] });
  fireEvent.click(screen.getByRole('button', { name: '编辑描述' }));
  fireEvent.change(screen.getByRole('textbox', { name: '团队描述' }), { target: { value: '更新的团队描述' } });
  fireEvent.click(screen.getByRole('button', { name: '保存描述' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('alpha', { description: '更新的团队描述' }));
  const picker = screen.getByRole('combobox', { name: '添加未归属团队的 Agent' });
  expect(picker).toHaveTextContent('free');
  expect(picker).not.toHaveTextContent('assigned');
  expect(picker).not.toHaveTextContent('referenced');
  fireEvent.change(picker, { target: { value: 'free' } });
  fireEvent.click(screen.getByRole('button', { name: '添加 Agent' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('alpha', { leader: { name: 'lead' }, workerNames: ['lead', 'w1', 'critic1', 'free'] }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

describe('InteractiveTeamTopology · 头部', () => {
  it('shows the team admin and keeps the leader in the member list', () => {
    renderTopology();
    const header = screen.getByTestId('team-topology-header');
    expect(screen.getByRole('list', { name: 'alpha 成员' }).querySelector('[data-worker-name="lead"]')).toHaveAttribute('data-role', 'leader');
    expect(within(header).queryByText('管理员 · boss')).toBeNull();
    expect(within(screen.getByRole('list', { name: '团队人类成员' })).getByText('团队管理员')).toBeInTheDocument();
    expect(within(header).queryByText(/Leader boss/)).toBeNull();
  });

  it('separates team information, human and Agent members, and opens existing member management', () => {
    const onOpenMembers = vi.fn();
    renderTopology({ onOpenMembers, userLevel: 3 });
    expect(screen.getByRole('region', { name: '基础信息' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent 成员' })).toHaveTextContent('qwenpaw · lead-model');
    expect(screen.getByRole('region', { name: '人类成员' })).toHaveTextContent('评审成员');
    expect(screen.getByRole('tab', { name: '基础信息' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('团队文件目录：alpha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '管理成员' }));
    expect(onOpenMembers).toHaveBeenCalledOnce();
  });

  it('opens files in a separate tab and defaults to information when switching teams', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { team: alpha, workers, onOpenWorker: vi.fn(), onOpenTeamSettings: vi.fn() };
    const { rerender } = render(<QueryClientProvider client={client}><InteractiveTeamTopology {...props} /></QueryClientProvider>);
    fireEvent.mouseDown(screen.getByRole('tab', { name: '团队文件' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('tabpanel', { name: '团队文件' })).toHaveTextContent('团队文件目录：alpha');
    expect(screen.queryByRole('region', { name: 'Agent 成员' })).toBeNull();
    rerender(<QueryClientProvider client={client}><InteractiveTeamTopology {...props} team={{ ...alpha, name: 'beta' }} /></QueryClientProvider>);
    expect(screen.getByRole('tab', { name: '基础信息' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('团队文件目录：alpha')).toBeNull();
  });

  it('shows member counts, readiness, sleeping and abnormal totals', () => {
    renderTopology();
    const header = screen.getByTestId('team-topology-header');
    expect(within(header).getByText('3 个 Agent')).toBeInTheDocument();
    expect(within(header).getByText('就绪 1/3')).toBeInTheDocument();
    expect(within(header).getByText('休眠 1')).toBeInTheDocument();
    expect(within(header).getByText('异常 1')).toBeInTheDocument();
  });

  it('header gear (≥44px, 查看团队详情) requests team details', () => {
    const { onOpenTeamSettings } = renderTopology();
    const header = screen.getByTestId('team-topology-header');
    // A 轮「团队设置」文本按钮已删。
    expect(screen.queryByRole('button', { name: '打开团队设置' })).toBeNull();
    // 头部只剩一个齿轮入口（触控目标 ≥44px），aria-label = 查看团队详情
    //（不再是「打开团队设置」——多栏下齿轮不再弹窗，语义按布局分派）。
    const gears = header.querySelectorAll('button[aria-label="查看团队详情"]');
    expect(gears).toHaveLength(1);
    expect(gears[0]).toHaveClass('min-h-11');
    fireEvent.click(screen.getByRole('button', { name: '查看团队详情' }));
    expect(onOpenTeamSettings).toHaveBeenCalledTimes(1);
    expect(onOpenTeamSettings).toHaveBeenCalledWith(alpha);
  });
});

describe('InteractiveTeamTopology · 悬浮 affordance（对齐 shiyiyue1102）', () => {
  it('keeps member hover feedback without repeating the team on every row', () => {
    renderTopology();
    const lead = within(screen.getByRole('list', { name: 'alpha 成员' })).getByText('lead').closest('[data-worker-name]') as HTMLElement;
    // 可点击成员名（行 = 可点 → 名字加下划线反馈）。
    expect(within(lead).getByText('lead')).toHaveClass('hover:underline');
    expect(within(lead).queryByText('alpha')).not.toBeInTheDocument();
  });

  it('成员行 hover:bg-muted/50 + focus-visible 环齐备', () => {
    renderTopology();
    const lead = within(screen.getByRole('list', { name: 'alpha 成员' })).getByText('lead').closest('[data-worker-name]') as HTMLElement;
    expect(lead).toHaveClass('hover:bg-muted/50');
    expect(lead).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:outline-none',
    );
  });
});

describe('InteractiveTeamTopology · 千锻入口', () => {
  it('keeps the compact entry beside team settings in the header', () => {
    renderTopology({ onOpenMillforge: vi.fn(), userLevel: 3 });
    const header = screen.getByTestId('team-topology-header');
    const entry = within(header).getByRole('button', { name: '打开千锻' });
    const settings = within(header).getByRole('button', { name: '查看团队详情' });
    expect(entry.parentElement).toContainElement(settings);
    expect(screen.queryByTestId('millforge-card')).not.toBeInTheDocument();
  });

  it('点击 → onOpenMillforge(team)', () => {
    const onOpenMillforge = vi.fn();
    renderTopology({ onOpenMillforge, userLevel: 3 });
    fireEvent.click(screen.getByRole('button', { name: '打开千锻' }));
    expect(onOpenMillforge).toHaveBeenCalledWith(alpha);
  });

  it('非 L1（<3）禁用并 title 给原因；L1 可用', () => {
    const onOpenMillforge = vi.fn();
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InteractiveTeamTopology
        team={alpha}
        workers={workers}
        onOpenWorker={vi.fn()}
        onOpenTeamSettings={vi.fn()}
        onOpenMillforge={onOpenMillforge}
        userLevel={2}
      />
      </QueryClientProvider>,
    );
    const card = screen.getByRole('button', { name: '打开千锻' });
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
    expect(screen.getByRole('button', { name: '打开千锻' })).toBeEnabled();
  });

  it('未传 onOpenMillforge 时不渲染千锻入口（老调用方布局不变）', () => {
    renderTopology();
    expect(screen.queryByRole('button', { name: '打开千锻' })).toBeNull();
  });
});

describe('InteractiveTeamTopology · 成员行', () => {
  it('renders role badges and per-member status', () => {
    renderTopology();
    const lead = within(screen.getByRole('list', { name: 'alpha 成员' })).getByText('lead').closest('[data-worker-name]') as HTMLElement;
    expect(lead).toHaveAttribute('data-role', 'leader');
    expect(within(lead).getByText('负责人')).toBeInTheDocument();
    expect(within(lead).getByText('运行中')).toBeInTheDocument();

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
    expect(within(screen.getByRole('list', { name: 'alpha 成员' })).queryByText('lead')).toBeNull();
    expect(screen.getByText('w1')).toBeInTheDocument();
  });

  it('keeps the whole team when the team name matches', () => {
    renderTopology({ searchQuery: 'alpha' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'alpha 成员' })).getByText('lead')).toBeInTheDocument();
    expect(screen.getByText('critic1')).toBeInTheDocument();
  });

  it('shows an empty result message when no member matches', () => {
    renderTopology({ searchQuery: 'nobody' });
    expect(screen.getByText('没有匹配的成员')).toBeInTheDocument();
  });
});
