import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { WorkspaceHome } from './workspace-home';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { useSectionStore } from '@/lib/section-store';
import type { BoardTask } from '@/hooks/use-task-board';
import type { ManagerResponse, TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

const env = vi.hoisted(() => ({
  userLevel: 3,
  models: { isSuccess: true, isPlaceholderData: false, data: [{}, {}, {}] },
  skills: { isSuccess: true, isPlaceholderData: false, data: { total: 5 } },
  tools: { isSuccess: true, isPlaceholderData: false, data: [{}, {}] },
  workers: { isSuccess: true, isPlaceholderData: false, data: [] as WorkerResponse[] },
}));

vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: (selector: (_state: { userLevel: number }) => unknown) => selector(env),
}));
vi.mock('@/hooks/use-agentteams-models', () => ({ useModels: () => env.models }));
vi.mock('@/hooks/use-skill-center', () => ({ useSkills: () => env.skills }));
vi.mock('@/hooks/use-agentteams-mcps', () => ({ useMcpServers: () => env.tools }));
vi.mock('@/hooks/use-projects', () => ({ useProjects: () => ({ data: { projects: [] } }) }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => env.workers }));
vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: () => ({ data: [] }) }));
vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: () => ({ data: [] }) }));

const MANAGER = { name: 'at-assistant', roomID: '!assistant:test' } as ManagerResponse;
const TEAM = { name: 'alpha', teamName: 'Alpha 团队' } as TeamResponse;

function task(overrides: Partial<BoardTask> & { runId: string }): BoardTask {
  return {
    title: '协作任务',
    status: 'in_progress',
    assignedTo: '@worker-1:test',
    teamId: 'alpha',
    roomId: '!room:test',
    dependsOn: [],
    createdAt: 1_700_000_000_000,
    outcome: null,
    source: 'test',
    ...overrides,
  };
}

function worker(overrides: Partial<WorkerResponse> & { name: string }): WorkerResponse {
  return {
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: 'default',
    runtime: 'openclaw',
    image: '',
    containerState: '',
    matrixUserID: '@worker:test',
    roomID: '!room:test',
    message: '',
    team: '',
    role: '',
    ...overrides,
  } as WorkerResponse;
}

/** 本周一中午（weeksAgo=0）或第 n 周前的周一中午。 */
function mondayOfWeek(weeksAgo: number): number {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - weeksAgo * 7);
  monday.setHours(12, 0, 0, 0);
  return monday.getTime();
}

function renderHome(props: Partial<Parameters<typeof WorkspaceHome>[0]> = {}) {
  return render(
    <WorkspaceHome
      teams={[TEAM]}
      managers={[MANAGER]}
      workerCount={4}
      tasks={[]}
      loading={false}
      degraded={false}
      {...props}
    />,
  );
}

function metricValue(label: string): string {
  const metrics = screen.getByTestId('home-metrics');
  const button = within(metrics).getByText(label).closest('button');
  return button?.querySelector('strong')?.textContent ?? '';
}

function assertDomOrder(...testIds: string[]): void {
  const nodes = testIds.map(id => screen.getByTestId(id));
  for (let i = 1; i < nodes.length; i += 1) {
    const follows = nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows, `${testIds[i]} should follow ${testIds[i - 1]}`).toBeTruthy();
  }
}

beforeEach(() => {
  env.userLevel = 3;
  env.workers.data = [];
  useHitlInboxStore.setState({ confirmations: {}, resolutions: {}, pendingChatRoomId: null, pendingProjectKey: null });
  useInviteStore.getState().clear();
  useExtensionStore.getState().clear();
  useSectionStore.setState({ activeSection: 'overview', taskCollaboration: null, mentionRoomId: null, notificationsOpen: false });
  window.location.hash = '';
});
afterEach(cleanup);

describe('WorkspaceHome — WORKSPACE baseline composition', () => {
  it('renders the hero (clock, headline, assistant card), live card, metrics, follow-ups, assets and plugin slots in order', () => {
    useHitlInboxStore.getState().upsertConfirmation({
      id: 'c1', roomId: '!room:test', eventId: '$e1', sender: '@worker-1:test',
      toolName: 'shell_exec', approveReply: 'approve', rejectReply: 'reject', timestamp: Date.now(),
    });
    useExtensionStore.getState().add('widgets', 'plugin-a', {
      id: 'w1', title: 'Widget One', component: () => <div>Widget One</div>, size: 'md',
    });
    renderHome({
      tasks: [
        task({ runId: 'r1', title: 'Agent 协作流程校验' }),
        task({ runId: 'r1-a', parentTaskId: 'r1', title: '检查一', status: 'completed', assignedTo: '@worker-1:test' }),
      ],
    });

    assertDomOrder('home-hero', 'home-metrics', 'home-followups', 'home-assets', 'plugin-widgets');
    const hero = screen.getByTestId('home-hero');
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toContain('一站式 AI 工作台');
    expect(within(hero).getByLabelText('向 AT 助手输入指令')).toBeInTheDocument();
    expect(within(hero).getByTestId('home-live')).toBeInTheDocument();
    expect(screen.getByText('待决策')).toBeInTheDocument();
    expect(screen.getByText('Widget One')).toBeInTheDocument();
  });

  it('prints the localized date line above the headline once mounted', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByTestId('home-hero').textContent).toMatch(/\d+月\d+日，星期\S+ · \d{2}:\d{2}/));
  });

  it('greets with the pending decision count once mounted', () => {
    useHitlInboxStore.getState().upsertConfirmation({
      id: 'c1', roomId: '!room:test', eventId: '$e1', sender: '@worker-1:test',
      toolName: 'shell_exec', approveReply: 'approve', rejectReply: 'reject', timestamp: Date.now(),
    });
    renderHome({ tasks: [task({ runId: 'r1' }), task({ runId: 'r2' })] });
    expect(screen.getByTestId('home-composer').textContent).toContain('今天有 1 事需要你确认');
  });

  it('counts active tasks, this-week completions, members and assets in the metrics bar', () => {
    renderHome({
      tasks: [
        task({ runId: 'r1', status: 'in_progress' }),
        task({ runId: 'r2', status: 'submitted' }),
        task({ runId: 'r3', status: 'completed', completedAt: mondayOfWeek(0) }),
        task({ runId: 'r4', status: 'completed', completedAt: mondayOfWeek(1) }),
        task({ runId: 'r5', status: 'failed' }),
      ],
    });

    expect(metricValue('进行中')).toBe('02');
    expect(metricValue('本周完成')).toBe('01');
    expect(metricValue('协作成员')).toBe('06');
    expect(metricValue('工作区资产')).toBe('16');
  });

  it('hides task metrics while the board is loading or degraded', () => {
    renderHome({ loading: true, tasks: [task({ runId: 'r1' })] });
    expect(metricValue('进行中')).toBe('—');
    expect(metricValue('本周完成')).toBe('—');
    expect(metricValue('协作成员')).toBe('06');
  });

  it('keeps the empty states for follow-ups, live card and composer when nothing is pending', () => {
    const { container } = renderHome();

    expect(screen.queryByText('待决策')).toBeNull();
    expect(container.querySelector('[data-testid="plugin-widgets"]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('暂无需要跟进的事项');
    expect(screen.getByTestId('home-composer')).toBeInTheDocument();
    expect(screen.getByTestId('home-live').textContent).toContain('等待 Agent 接入');
    expect(screen.getByRole('heading', { name: '工作区资产' })).toBeInTheDocument();
  });

  it('shows the featured follow-up with progress and opens it from the action button', () => {
    renderHome({
      tasks: [
        task({ runId: 'r1', title: 'Agent 协作流程 v2.0 校验', projectId: 'p-1' }),
        task({ runId: 'r1-a', parentTaskId: 'r1', projectId: 'p-1', status: 'completed' }),
        task({ runId: 'r1-b', parentTaskId: 'r1', projectId: 'p-1', status: 'in_progress' }),
      ],
    });

    const featured = screen.getByTestId('home-featured');
    expect(within(featured).getByText('Agent 协作流程 v2.0 校验')).toBeInTheDocument();
    expect(featured.textContent).toContain('子任务 1 / 2');
    fireEvent.click(within(featured).getByRole('button', { name: /继续推进/ }));
    expect(window.location.hash).toBe('#workbench/tasks?project=p-1');
  });

  it('marks the featured follow-up with its downstream blocking count', () => {
    renderHome({
      tasks: [
        task({ runId: 'r1', title: 'Agent 协作流程 v2.0 校验' }),
        task({ runId: 'r2', dependsOn: ['r1'], title: '下游任务' }),
        task({ runId: 'r3', dependsOn: ['r1'], title: '下游任务二' }),
      ],
    });
    expect(screen.getByTestId('home-featured').textContent).toContain('阻塞下游 2 项');
  });

  it('renders the live collaboration topology from running workers with their task progress', () => {
    env.workers.data = [
      worker({ name: 'research', team: 'alpha' }),
      worker({ name: 'report', team: '', phase: 'Sleeping' }),
    ];
    renderHome({
      tasks: [
        task({ runId: 'r1', title: '调研协作流程', assignedTo: '@research:test' }),
        task({ runId: 'r1-a', parentTaskId: 'r1', status: 'completed', assignedTo: '@research:test' }),
      ],
    });

    const live = screen.getByTestId('home-live');
    expect(within(live).getByText('02 AGENTS')).toBeInTheDocument();
    expect(within(live).getByText('你')).toBeInTheDocument();
    expect(within(live).getByText('research')).toBeInTheDocument();
    expect(within(live).getByText('调研协作流程')).toBeInTheDocument();
    expect(live.textContent).toContain('100%');
    expect(within(live).queryByText('report')).toBeNull();
    expect(live.textContent).toContain('持续交付中');
  });

  it('falls back to the worker team label when a running agent has no active task', () => {
    env.workers.data = [worker({ name: 'report', team: 'alpha' })];
    renderHome();

    const live = screen.getByTestId('home-live');
    expect(within(live).getByText('report')).toBeInTheDocument();
    expect(within(live).getByText('Alpha 团队')).toBeInTheDocument();
    expect(live.textContent).toContain('01 AGENTS');
  });
});

describe('WorkspaceHome — command composer', () => {
  it('seeds the assistant room draft and deep-links into the conversation on submit', () => {
    renderHome();

    const input = screen.getByLabelText('向 AT 助手输入指令');
    fireEvent.change(input, { target: { value: '汇总今天的阻塞项' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    expect(localStorage.getItem('agentteams-chat-draft:!assistant:test')).toBe('汇总今天的阻塞项');
    expect(useSectionStore.getState().activeSection).toBe('chat');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!assistant:test');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('keeps the send button disabled for blank input', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled();
  });

  it('sends a quick command prompt straight to the assistant', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: '今天先做什么' }));

    expect(localStorage.getItem('agentteams-chat-draft:!assistant:test')).toContain('优先处理');
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('falls back to the chat section when no assistant room is reachable', () => {
    renderHome({ managers: [{ name: 'at-assistant' } as ManagerResponse] });

    fireEvent.change(screen.getByLabelText('向 AT 助手输入指令'), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    expect(useSectionStore.getState().activeSection).toBe('chat');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(localStorage.getItem('agentteams-chat-draft:!assistant:test')).toBeNull();
  });
});

describe('WorkspaceHome — workspace assets grid', () => {
  it('renders the four real asset tiles and opens their sections', () => {
    renderHome();

    const assets = screen.getByTestId('home-assets');
    for (const label of ['成员与权限', '模型', '技能', 'MCP 工具']) {
      expect(within(assets).getByText(label)).toBeInTheDocument();
    }
    expect(assets.textContent).toContain('16 项');

    fireEvent.click(within(assets).getByText('模型').closest('button')!);
    expect(useSectionStore.getState().activeSection).toBe('models');
  });

  it('shows placeholder dashes while asset counts are loading', () => {
    env.models.isSuccess = false;
    try {
      renderHome();
      expect(screen.getByTestId('home-assets').textContent).toContain('统计中');
    } finally {
      env.models.isSuccess = true;
    }
  });
});

describe('WorkspaceHome — plugin widgets slot', () => {
  it('renders registered widgets after the assets section', () => {
    useExtensionStore.getState().add('widgets', 'plugin-a', {
      id: 'w1', title: 'Widget One', component: () => <div>Widget One</div>, size: 'md',
    });
    renderHome();

    assertDomOrder('home-assets', 'plugin-widgets');
    expect(screen.getByText('Widget One')).toBeInTheDocument();
  });

  it('drops the widget grid when the plugin is removed', () => {
    useExtensionStore.getState().add('widgets', 'plugin-a', {
      id: 'w1', title: 'Widget One', component: () => <div>Widget One</div>, size: 'md',
    });
    const { unmount } = renderHome();
    expect(screen.getByText('Widget One')).toBeInTheDocument();

    act(() => { useExtensionStore.getState().removePlugin('plugin-a'); });
    expect(screen.queryByText('Widget One')).toBeNull();
    unmount();
  });
});

describe('WorkspaceHome — accessibility (axe-core)', () => {
  // jsdom has no real layout, so the color-contrast rule stays disabled here
  // (same scope as worker-card.a11y.test.tsx); AA contrast is covered by the
  // token-level assertions in a11y-axe.test.tsx.
  it('has no critical axe violations with tasks, HITL items and widgets present', async () => {
    useHitlInboxStore.getState().upsertConfirmation({
      id: 'c1', roomId: '!room:test', eventId: '$e1', sender: '@worker-1:test',
      toolName: 'shell_exec', approveReply: 'approve', rejectReply: 'reject', timestamp: Date.now(),
    });
    useExtensionStore.getState().add('widgets', 'plugin-a', {
      id: 'w1', title: 'Widget One', component: () => <div>Widget One</div>, size: 'md',
    });
    env.workers.data = [worker({ name: 'research', team: 'alpha' })];
    const { container } = renderHome({ tasks: [task({ runId: 'r1', title: 'Agent 协作流程校验' })] });

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.filter(v => v.impact === 'critical')).toEqual([]);
  });
});
