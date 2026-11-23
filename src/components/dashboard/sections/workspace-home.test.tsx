import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { WorkspaceHome } from './workspace-home';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import type { BoardTask } from '@/hooks/use-task-board';
import type { ManagerResponse, TeamResponse } from '@/lib/agentteams-api';

const env = vi.hoisted(() => ({
  userLevel: 3,
  models: { isSuccess: true, isPlaceholderData: false, data: [{}, {}, {}] },
  skills: { isSuccess: true, isPlaceholderData: false, data: { total: 5 } },
  tools: { isSuccess: true, isPlaceholderData: false, data: [{}, {}] },
}));

vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: (selector: (_state: { userLevel: number }) => unknown) => selector(env),
}));
vi.mock('@/hooks/use-agentteams-models', () => ({ useModels: () => env.models }));
vi.mock('@/hooks/use-skill-center', () => ({ useSkills: () => env.skills }));
vi.mock('@/hooks/use-agentteams-mcps', () => ({ useMcpServers: () => env.tools }));

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

function confirmation(id: string, toolName = 'shell_exec') {
  return {
    id, roomId: '!room:test', eventId: `$e1-${id}`, sender: '@worker-1:test',
    toolName, approveReply: 'approve', rejectReply: 'reject', timestamp: Date.now(),
  };
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
  const button = screen.getByText(label).closest('button');
  return button?.querySelector('strong')?.textContent ?? '';
}

function sectionByTitle(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const section = heading.closest('section');
  if (!section) throw new Error(`missing section for ${title}`);
  return section as HTMLElement;
}

beforeEach(() => {
  env.userLevel = 3;
  env.models.isSuccess = true;
  useHitlInboxStore.setState({ confirmations: {}, resolutions: {}, pendingChatRoomId: null, pendingProjectKey: null });
  useSectionStore.setState({ activeSection: 'overview', taskCollaboration: null, mentionRoomId: null, notificationsOpen: false });
  localStorage.clear();
  window.location.hash = '';
});
afterEach(cleanup);

describe('WorkspaceHome — classic layout', () => {
  it('renders the hero, metrics, recommendations, assets and board sections in order', () => {
    renderHome({ tasks: [task({ runId: 'r1' })] });

    const hero = screen.getByLabelText('你的协作工作区');
    const metrics = screen.getByLabelText('工作区摘要');
    const recommend = screen.getByRole('region', { name: '今日推荐' });
    const assets = sectionByTitle('工作区资产');
    const board = sectionByTitle('正在推进');
    expect(hero.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(metrics.compareDocumentPosition(recommend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(recommend.parentElement).toBe(assets.parentElement);
    expect(recommend.compareDocumentPosition(assets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(assets.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe('一站式AI工作台构建-协作-治理');
  });

  it('prints the localized date line once mounted', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} · 星期\S+/)).toBeInTheDocument());
  });

  it('counts teams, agents, tasks and assets in the metrics bar', () => {
    renderHome({ tasks: [task({ runId: 'r1' })] });

    expect(metricValue('协作团队')).toBe('01');
    expect(metricValue('Agent')).toBe('05');
    expect(metricValue('任务')).toBe('01');
    expect(metricValue('模型、技能和工具')).toBe('10');
  });

  it('hides task and asset counts while data is unresolved', () => {
    env.models.isSuccess = false;
    try {
      renderHome({ loading: true, tasks: [task({ runId: 'r1' })] });
      expect(metricValue('任务')).toBe('—');
      expect(metricValue('模型、技能和工具')).toBe('—');
      expect(metricValue('协作团队')).toBe('01');
    } finally {
      env.models.isSuccess = true;
    }
  });

  it('shows the featured task with subtask progress and deep-links to the board', () => {
    renderHome({
      tasks: [
        task({ runId: 'r1', title: 'Agent 协作流程 v2.0 校验', projectId: 'p-1' }),
        task({ runId: 'r1-a', parentTaskId: 'r1', projectId: 'p-1', status: 'completed' }),
        task({ runId: 'r1-b', parentTaskId: 'r1', projectId: 'p-1', status: 'in_progress' }),
      ],
    });

    const featured = within(screen.getByLabelText('你的协作工作区')).getByText('Agent 协作流程 v2.0 校验').closest('div') as HTMLElement;
    expect(featured.textContent).toContain('子任务 1 / 2');
    fireEvent.click(within(featured).getByRole('button', { name: /查看任务/ }));
    expect(window.location.hash).toBe('#workbench/tasks?project=p-1');
  });

  it('lists active tasks with status colors and opens one from the board link', () => {
    renderHome({
      tasks: [
        task({ runId: 'r1', title: '任务甲', status: 'in_progress', projectId: 'p-1' }),
        task({ runId: 'r2', title: '任务乙', status: 'submitted' }),
        task({ runId: 'r3', title: '任务丙', status: 'failed' }),
      ],
    });

    const board = sectionByTitle('正在推进');
    expect(within(board).getByText('任务甲')).toBeInTheDocument();
    expect(within(board).getByText('任务乙')).toBeInTheDocument();
    expect(within(board).queryByText('任务丙')).toBeNull();
    const row = within(board).getByText('任务甲').closest('div')?.parentElement as HTMLElement;
    expect(row.querySelector('span[style]')).toHaveStyle({ backgroundColor: '#CB9300' });
    fireEvent.click(within(row).getByRole('button', { name: /查看/ }));
    expect(window.location.hash).toBe('#workbench/tasks?project=p-1');
  });

  it('keeps the loading, degraded and empty states for the active task list', () => {
    const { unmount } = renderHome({ loading: true });
    expect(screen.getByText('正在加载任务…')).toBeInTheDocument();
    unmount();

    renderHome({ degraded: true });
    expect(within(sectionByTitle('正在推进')).getByText('任务暂时无法加载，请稍后重试。')).toBeInTheDocument();

    renderHome({ tasks: [] });
    expect(screen.getByText('暂无正在推进的任务')).toBeInTheDocument();
  });

  it('renders the asset rows and opens their sections', () => {
    renderHome();

    const assets = sectionByTitle('工作区资产');
    expect(within(assets).getByText('模型管理')).toBeInTheDocument();
    expect(within(assets).getByText('3 项资产')).toBeInTheDocument();
    expect(within(assets).getByText('5 项资产')).toBeInTheDocument();
    expect(within(assets).getByText('2 项资产')).toBeInTheDocument();
    fireEvent.click(within(assets).getAllByRole('button', { name: '打开' })[0]);
    expect(useSectionStore.getState().activeSection).toBe('models');
  });
});

describe('WorkspaceHome — command composer', () => {
  it('seeds the assistant room draft and deep-links into the conversation on submit', () => {
    renderHome();

    const input = screen.getByLabelText('向 AT 助手输入指令');
    fireEvent.change(input, { target: { value: '汇总今天的阻塞项' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(localStorage.getItem('agentteams-chat-draft:!assistant:test')).toBe('汇总今天的阻塞项');
    expect(useSectionStore.getState().activeSection).toBe('chat');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!assistant:test');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('keeps the send button disabled for blank input', () => {
    renderHome();
    expect(screen.getByRole('button', { name: '发送指令' })).toBeDisabled();
  });

  it('toggles the composer context and agent-assignment chips', () => {
    renderHome();

    const chip = screen.getByRole('button', { name: '+ 添加上下文' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const auto = screen.getByRole('button', { name: '自动分配 Agent' });
    expect(auto).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(auto);
    expect(auto).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to the chat section when no assistant room is reachable', () => {
    renderHome({ managers: [{ name: 'at-assistant' } as ManagerResponse] });

    fireEvent.change(screen.getByLabelText('向 AT 助手输入指令'), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送指令' }));

    expect(useSectionStore.getState().activeSection).toBe('chat');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(localStorage.getItem('agentteams-chat-draft:!assistant:test')).toBeNull();
  });

  it('hides the composer for users below the assistant level', () => {
    env.userLevel = 2;
    renderHome();

    expect(screen.queryByLabelText('向 AT 助手输入指令')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看任务/ })).toBeNull();
  });
});

describe('WorkspaceHome — today recommendations', () => {
  it('prioritizes pending confirmations and opens their room', () => {
    useHitlInboxStore.getState().upsertConfirmation(confirmation('c1', 'mcp_mail'));
    renderHome();

    const recommend = screen.getByRole('region', { name: '今日推荐' });
    expect(within(recommend).getByText('确认 mcp_mail')).toBeInTheDocument();
    fireEvent.click(within(recommend).getByRole('button', { name: '去处理' }));
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!room:test');
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('fills the remaining slots with active tasks and caps at three rows', () => {
    useHitlInboxStore.getState().upsertConfirmation(confirmation('c1'));
    renderHome({
      tasks: [
        task({ runId: 'r1', title: '任务甲' }),
        task({ runId: 'r2', title: '任务乙', status: 'submitted' }),
        task({ runId: 'r3', title: '任务丙', status: 'revision' }),
      ],
    });

    const recommend = screen.getByRole('region', { name: '今日推荐' });
    expect(within(recommend).getByText('确认 shell_exec')).toBeInTheDocument();
    expect(within(recommend).getByText('推进 任务甲')).toBeInTheDocument();
    expect(within(recommend).getByText('验收 任务乙')).toBeInTheDocument();
    expect(within(recommend).getAllByRole('button', { name: '去处理' })).toHaveLength(3);
  });

  it('opens the recommended task on the board', () => {
    renderHome({ tasks: [task({ runId: 'r1', title: '任务甲', projectId: 'p-1' })] });

    const recommend = screen.getByRole('region', { name: '今日推荐' });
    fireEvent.click(within(recommend).getByRole('button', { name: '去处理' }));
    expect(window.location.hash).toBe('#workbench/tasks?project=p-1');
  });

  it('sends a quick command straight to the assistant', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: '今天先做什么' }));

    expect(localStorage.getItem('agentteams-chat-draft:!assistant:test')).toBe('今天先做什么');
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('keeps the loading, degraded and empty recommendation states', () => {
    const first = renderHome({ loading: true });
    expect(within(screen.getByRole('region', { name: '今日推荐' })).getByText('正在加载推荐…')).toBeInTheDocument();
    first.unmount();

    const second = renderHome({ degraded: true });
    expect(within(screen.getByRole('region', { name: '今日推荐' })).getByText('任务暂时无法加载，请稍后重试。')).toBeInTheDocument();
    second.unmount();

    renderHome({ tasks: [] });
    expect(within(screen.getByRole('region', { name: '今日推荐' })).getByText('今日暂无推荐，先和 AT 助手说一句吧')).toBeInTheDocument();
  });
});

describe('WorkspaceHome — hero typography', () => {
  it('keeps the hero headline and slogan on the global font stack with no bundled display font', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/dashboard/sections/workspace-home.module.css'), 'utf8');
    expect(css).not.toMatch(/font-family|AlimamaDFK|Kaiti/);
  });
});

describe('WorkspaceHome — accessibility (axe-core)', () => {
  // jsdom has no real layout, so the color-contrast rule stays disabled here
  // (same scope as worker-card.a11y.test.tsx); AA contrast is covered by the
  // token-level assertions in a11y-axe.test.tsx.
  it('has no critical axe violations with the composer and recommendations present', async () => {
    useHitlInboxStore.getState().upsertConfirmation(confirmation('c1'));
    const { container } = renderHome({ tasks: [task({ runId: 'r1', title: 'Agent 协作流程校验' })] });

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.filter(v => v.impact === 'critical')).toEqual([]);
  });
});
