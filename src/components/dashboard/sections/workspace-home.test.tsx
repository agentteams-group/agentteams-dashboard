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
  projects: { data: { projects: [] } },
}));

vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: (selector: (_state: { userLevel: number }) => unknown) => selector(env),
}));
vi.mock('@/hooks/use-agentteams-models', () => ({ useModels: () => env.models }));
vi.mock('@/hooks/use-skill-center', () => ({ useSkills: () => env.skills }));
vi.mock('@/hooks/use-agentteams-mcps', () => ({ useMcpServers: () => env.tools }));
vi.mock('@/hooks/use-projects', () => ({ useProjects: () => env.projects, useApiTaskBoard: () => ({ tasks: [], isLoading: false, degraded: false }) }));
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

function confirmation(id: string, toolName = 'shell_exec') {
  return {
    id, roomId: '!room:test', eventId: `$e1-${id}`, sender: '@worker-1:test',
    toolName, approveReply: 'approve', rejectReply: 'reject', timestamp: Date.now(),
  };
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
  return button?.querySelector('span')?.textContent ?? '';
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
  env.projects = { data: { projects: [] } };
  useHitlInboxStore.setState({ confirmations: {}, resolutions: {}, pendingChatRoomId: null, pendingProjectKey: null });
  useInviteStore.getState().clear();
  useExtensionStore.getState().clear();
  useSectionStore.setState({ activeSection: 'overview', taskCollaboration: null, mentionRoomId: null, notificationsOpen: false });
  window.location.hash = '';
});
afterEach(cleanup);

describe('WorkspaceHome — WORKSPACE baseline composition', () => {
  it('renders brand, hero (clock, title, assistant card, live card), metrics, follow-ups, assets and plugin slots in order', () => {
    useHitlInboxStore.getState().upsertConfirmation(confirmation('c1'));
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
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe('一站式 AI 工作台');
    expect(within(hero).getByLabelText('向 AT 助手输入指令')).toBeInTheDocument();
    expect(within(hero).getByTestId('home-live')).toBeInTheDocument();
    expect(within(hero).getByText('已关联工作区')).toBeInTheDocument();
    expect(screen.getByText('确认 shell_exec')).toBeInTheDocument();
    expect(screen.getByText('Widget One')).toBeInTheDocument();
  });

  it('prints the localized date line above the headline once mounted', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByTestId('home-hero').textContent).toMatch(/\d+ 月 \d+ 日，星期\S+ · \d{2}:\d{2}/));
  });

  it('greets with the pending decision count once mounted', () => {
    useHitlInboxStore.getState().upsertConfirmation(confirmation('c1'));
    renderHome({ tasks: [task({ runId: 'r1' }), task({ runId: 'r2' })] });
    expect(screen.getByTestId('home-composer').textContent).toContain('今天只有 1 件事需要你确认');
    expect(screen.getByTestId('home-composer').textContent).toContain('其余 2 项，交给 Agent 就好');
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

    expect(screen.queryByText('确认 shell_exec')).toBeNull();
    expect(container.querySelector('[data-testid="plugin-widgets"]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('暂无需要跟进的事项');
    expect(screen.getByTestId('home-composer')).toBeInTheDocument();
    expect(screen.getByTestId('home-live').textContent).toContain('等待 Agent 接入');
    expect(within(screen.getByTestId('home-assets')).getByText('工作区资产')).toBeInTheDocument();
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
    expect(featured.textContent).toContain('50%');
    expect(within(featured).getByLabelText('焦点任务进度')).toHaveAttribute('aria-valuenow', '50');
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
    expect(screen.getByTestId('home-followups').textContent).toContain('完成后解锁下游 2 项');
  });

  it('renders pending confirmations as numbered follow-up rows that open the room', () => {
    useHitlInboxStore.getState().upsertConfirmation(confirmation('c1', 'mcp_mail'));
    renderHome();

    const followups = screen.getByTestId('home-followups');
    expect(within(followups).getByText('确认 mcp_mail')).toBeInTheDocument();
    expect(within(followups).getByText('去确认')).toBeInTheDocument();
    fireEvent.click(within(followups).getByRole('button', { name: '去确认' }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!room:test');
    expect(useSectionStore.getState().activeSection).toBe('chat');
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
    expect(live.textContent).toContain('你');
    expect(live.textContent).toContain('research');
    expect(live.textContent).toContain('调研协作流程');
    expect(live.textContent).toContain('research 100%');
    expect(live.textContent).not.toContain('report');
    expect(live.textContent).toContain('持续交付中');
    expect(live.querySelector('svg[role="img"]')).not.toBeNull();
  });

  it('falls back to the worker team label when a running agent has no active task', () => {
    env.workers.data = [worker({ name: 'report', team: 'alpha' })];
    renderHome();

    const live = screen.getByTestId('home-live');
    expect(live.textContent).toContain('report');
    expect(live.textContent).toContain('Alpha 团队');
    expect(within(live).getByText('01 AGENTS')).toBeInTheDocument();
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
    expect(within(assets).getByText('16 项')).toBeInTheDocument();

    fireEvent.click(within(assets).getByText('模型'));
    expect(useSectionStore.getState().activeSection).toBe('models');
  });

  it('shows the loading caption while asset counts are unresolved', () => {
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
  it('has no critical axe violations with tasks, follow-up rows and widgets present', async () => {
    useHitlInboxStore.getState().upsertConfirmation(confirmation('c1'));
    useExtensionStore.getState().add('widgets', 'plugin-a', {
      id: 'w1', title: 'Widget One', component: () => <div>Widget One</div>, size: 'md',
    });
    env.workers.data = [worker({ name: 'research', team: 'alpha' })];
    const { container } = renderHome({ tasks: [task({ runId: 'r1', title: 'Agent 协作流程校验' })] });

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.filter(v => v.impact === 'critical')).toEqual([]);
  });
});
