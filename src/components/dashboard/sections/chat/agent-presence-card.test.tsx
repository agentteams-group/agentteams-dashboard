/**
 * C-5「Agent 此刻在做什么」悬浮卡单测。
 *
 * 钉的全是诚实性那几条：有数据才出一行、任务归属不上就带「房间级」徽标、
 * 四项全缺只剩一句「这个服务端没有回报该 Agent 的运行状态」、直达链接写的
 * 是 tasksHash(...)；另外钉住「人类发送者不挂卡、头像本来不可点没被改坏」。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPresenceCard, buildPresenceRows, pickAgentNode } from './agent-presence-card';
import type { AgentPresenceCardProps } from './agent-presence-card';
import { MessageBubble } from './views/MessageBubble';
import { TooltipProvider } from '@/components/ui/tooltip';
import { roomHash, tasksHash } from '@/lib/nav-hash';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useTaskStore } from '@/lib/task-store';
import type { WorkerAgentStatusInfo } from '@/lib/worker-session-state';
import type { WorkflowResponse } from '@/lib/agentteams-projects-api';

// 卡片自己开 timer（延后关闭的余量），假定时器由 vitest 配置决定，这里不用；
// 但时长行完全依赖 useSessionTick 的 now，必须钉死，否则「运行了 X」随钟走。
const ROOM = '!room:example.org';
const SENDER = '@designer:example.org';
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

/** 被 mock 的两个 hook 的可变输入（hoisted：工厂在 import 阶段就会被调用）。 */
const mocks = vi.hoisted(() => ({
  statusMap: {} as Record<string, WorkerAgentStatusInfo & { phase?: string }>,
  now: 0,
  activeRoomId: null as string | null,
}));

vi.mock('@/hooks/use-worker-session-state', () => ({
  useWorkerAgentStatusMap: () => mocks.statusMap,
  useSessionTick: () => mocks.now,
}));

// 只换掉「当前房间」这一个订阅：MessageBubble 还要用同模块的
// isMessageReadByOthers / DisplayMessage，整体替换会把它一起弄坏。
vi.mock('@/hooks/use-matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-matrix')>()),
  useRoomMetaStore: (selector: (_s: { activeRoomId: string | null }) => unknown) =>
    selector({ activeRoomId: mocks.activeRoomId }),
}));

const mockGetProjectWorkflow = vi.fn();
vi.mock('@/lib/agentteams-projects-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentteams-projects-api')>()),
  getProjectWorkflow: (...args: unknown[]) => mockGetProjectWorkflow(...args),
}));

// 种 HITL 待办会 fire-and-forget 上报审计（真 fetch）；测试里掐掉。
const mockRecordHitlAudit = vi.fn();
vi.mock('@/lib/hitl-audit', () => ({
  recordHitlAudit: (...args: unknown[]) => mockRecordHitlAudit(...args),
}));

const markdownMock = vi.fn(({ content }: { content: string }) => <div>{content}</div>);
// 路径以本文件为基准：MessageBubble 引的 '../markdown-message' 就是这里的
// './markdown-message'（同一个 sections/chat/markdown-message.tsx）。
vi.mock('./markdown-message', () => ({
  MarkdownMessage: (props: { content: string }) => markdownMock(props),
}));

/** 项目 overlay 夹具：assignee 写的是 designer，节点名与快照里的不同，
 *  正好用来证明「当前节点」取的是正源 overlay 而不是消息快照。 */
function projectFixture(): WorkflowResponse {
  return {
    project_id: 'proj-1',
    title: '产品介绍页生产线',
    status: 'running',
    nodes: [
      { id: 'info', name: '信息架构', status: 'completed' },
      { id: 'design', name: '页面设计', status: 'in_progress', assignee: 'designer' },
    ],
    edges: [{ source: 'info', target: 'design' }],
    next: [],
    interrupts: [],
    tasks_detail: [],
  } as unknown as WorkflowResponse;
}

/** 空 DAG 的项目（planning 类项目就是纯状态）：让默认实现不返回 undefined，
 *  否则 react-query 会对 undefined data 报错，把日志搞脏。 */
function emptyProjectFixture(): WorkflowResponse {
  return {
    project_id: 'proj-empty',
    title: '空项目',
    status: 'planning',
    nodes: [],
    edges: [],
    next: [],
    interrupts: [],
  } as unknown as WorkflowResponse;
}

function seedHeartbeat(overrides: Partial<WorkerAgentStatusInfo & { phase?: string }> = {}) {
  mocks.statusMap[SENDER] = { ...overrides };
}

function seedRoomTask(overrides: Record<string, unknown> = {}) {
  useTaskStore.getState().upsertTask({
    runId: 'proj-1',
    title: '产品介绍页生产线',
    status: 'running',
    roomId: ROOM,
    senderMatrixUserId: '@manager:example.org',
    subagents: [],
    steps: [{ id: 'info', name: '信息架构', status: 'completed' }],
    ...overrides,
  });
}

function seedPendingConfirmation(overrides: Record<string, unknown> = {}) {
  useHitlInboxStore.getState().upsertConfirmation({
    id: 'c1',
    roomId: ROOM,
    eventId: '$e1',
    sender: SENDER,
    toolName: 'Bash',
    approveReply: '/approve',
    rejectReply: '拒绝',
    timestamp: NOW,
    ...overrides,
  });
}

/** hover 打开卡片：卡包的正是头像外面那一层 div（不挂卡时它是普通容器）。 */
function openCardByHover(triggerEl: HTMLElement) {
  fireEvent.mouseEnter(triggerEl.parentElement as HTMLElement);
}

function renderPresenceCard(overrides: Partial<AgentPresenceCardProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <AgentPresenceCard
        sender={SENDER}
        workerName="designer"
        senderLabel="设计 Agent"
        senderStatus="running"
        {...overrides}
      >
        <button type="button">头像</button>
      </AgentPresenceCard>
    </QueryClientProvider>,
  );
  const avatar = utils.getByRole('button', { name: '头像' });
  return { avatar, client, ...utils };
}

function card(): Element | null {
  return document.querySelector('[data-presence-card]');
}

describe('AgentPresenceCard（C-5 此刻在做什么）', () => {
  beforeEach(() => {
    mocks.statusMap = {};
    mocks.now = NOW;
    mocks.activeRoomId = ROOM;
    window.location.hash = `#workbench/space/${ROOM}`;
    mockGetProjectWorkflow.mockReset();
    mockGetProjectWorkflow.mockResolvedValue(emptyProjectFixture());
  });

  afterEach(() => {
    cleanup();
    useTaskStore.getState().clearTasks();
    useHitlInboxStore.getState().clearConfirmations();
    window.location.hash = '';
  });

  it('四项齐全：逐行渲染，直达链接写的是 tasksHash(project)', async () => {
    seedHeartbeat({
      agentStatus: 'running',
      runningTaskCount: 2,
      lastRunAt: new Date(NOW - 12 * 60_000).toISOString(),
      lastFinishAt: new Date(NOW - 3 * 60_000).toISOString(),
      phase: 'Running',
    });
    seedRoomTask();
    seedPendingConfirmation();
    mockGetProjectWorkflow.mockResolvedValue(projectFixture());

    const { avatar } = renderPresenceCard();
    openCardByHover(avatar);

    // 节点行来自项目正源（overlay 里叫「页面设计」，消息快照里只有一条「信息架构」）。
    expect(await screen.findByText('当前节点')).toBeInTheDocument();
    expect(screen.getByText('页面设计')).toBeInTheDocument();
    expect(screen.getByText('等待确认')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('运行了 12 分钟')).toBeInTheDocument();
    expect(screen.getByText('3 分钟前完成')).toBeInTheDocument();
    // 归属成功：不该出现房间级徽标。
    expect(screen.queryByText('房间级')).not.toBeInTheDocument();
    // 「当前工具」这一位有 HITL 工具名时不再退成运行时描述。
    expect(screen.queryByText('运行时')).not.toBeInTheDocument();
    await waitFor(() => expect(mockGetProjectWorkflow).toHaveBeenCalledWith('proj-1', { includeTasks: true }));

    const link = screen.getByRole('link', { name: /在任务看板打开/ });
    expect(link).toHaveAttribute('href', tasksHash('proj-1'));
    fireEvent.click(link);
    expect(window.location.hash).toBe(tasksHash('proj-1'));
    // 关卡收尾 + 头像本体不受影响。
    expect(card()).toBeNull();
    expect(avatar).toBeEnabled();
  });

  it('只有状态表没有任务：不出节点行，链接退成本空间深链', async () => {
    seedHeartbeat({ agentStatus: 'running', runningTaskCount: 1 });

    const { avatar } = renderPresenceCard();
    openCardByHover(avatar);

    expect(await screen.findByText('运行时')).toBeInTheDocument();
    expect(screen.getByText('运行中 · 1 个任务在跑')).toBeInTheDocument();
    expect(screen.queryByText('当前节点')).not.toBeInTheDocument();
    expect(screen.queryByText('本房间当前')).not.toBeInTheDocument();
    expect(screen.queryByText('房间级')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /在本空间查看/ })).toHaveAttribute('href', roomHash(ROOM));
  });

  it('四项全缺：只剩一句「服务端未回报」，不猜数据也不叠推断 chip', async () => {
    mocks.activeRoomId = null;

    const { avatar } = renderPresenceCard({ senderStatus: null });
    openCardByHover(avatar);

    expect(await screen.findByText('这个服务端没有回报该 Agent 的运行状态')).toBeInTheDocument();
    expect(card()).not.toBeNull();
    for (const label of ['当前节点', '本房间当前', '等待确认', '运行时', '已运行', '最近状态变更']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // 全缺时连「运行中」这种推断 chip 也不出（免得跟降级话术同屏矛盾）。
    expect(screen.queryByText('运行中')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('人类发送者不挂卡：children 原样透出，hover 也不会有卡', () => {
    const { avatar } = renderPresenceCard({ workerName: undefined });
    openCardByHover(avatar);

    expect(avatar).toBeInTheDocument();
    expect(card()).toBeNull();
  });

  it('MessageBubble：人类发送者的头像不挂卡且仍不可点', () => {
    const { container } = render(
      <TooltipProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MessageBubble
            message={{
              id: '$human',
              sender: '@alice:example.org',
              senderShort: 'alice',
              content: '今天进度如何',
              timestamp: NOW,
              type: 'm.text',
              isMe: false,
            }}
            showSender
            isContinuation={false}
            onOpenWorkerChats={vi.fn()}
          />
        </QueryClientProvider>
      </TooltipProvider>,
    );

    // 人头像本来就没有包裹层（不挂卡），且按钮仍 disabled。
    expect(card()).toBeNull();
    const avatarButton = container.querySelector('button');
    expect(avatarButton).not.toBeNull();
    expect(avatarButton).toBeDisabled();

    fireEvent.mouseEnter(avatarButton as Element as HTMLElement);
    expect(card()).toBeNull();
  });

  it('任务归属不上：给房间级数据并带「房间级」徽标', async () => {
    seedRoomTask({
      runId: 'proj-9',
      title: '周报生成',
      steps: [{ id: 'w', name: '写周报', status: 'in_progress', assignedTo: 'writer' }],
    });

    const { avatar } = renderPresenceCard();
    openCardByHover(avatar);

    expect(await screen.findByText('本房间当前')).toBeInTheDocument();
    expect(screen.getByText('周报生成')).toBeInTheDocument();
    expect(screen.queryByText('当前节点')).not.toBeInTheDocument();
    const badge = screen.getByText('房间级');
    expect(badge.closest('[data-slot="badge"]')).toHaveAttribute(
      'title',
      expect.stringContaining('没有按 Agent 归属的字段'),
    );
  });

  it('纯逻辑：只认名下节点，房间级行才带归属徽标', () => {
    const steps = [
      { id: 'a', name: '信息架构', status: 'completed' },
      { id: 'b', name: '页面设计', status: 'in_progress', assignedTo: '@designer:example.org' },
    ];
    expect(pickAgentNode(steps, 'designer')).toEqual({
      scope: 'agent',
      title: '页面设计',
      status: 'in_progress',
    });
    expect(pickAgentNode(steps, 'writer')).toBeNull();

    const roomRows = buildPresenceRows({
      status: { agentStatus: 'running' },
      node: { scope: 'room', title: '周报生成', status: 'running' },
      now: NOW,
    });
    expect(roomRows[0].label).toBe('本房间当前');
    expect(roomRows[0].scopeBadge?.label).toBe('房间级');

    const agentRows = buildPresenceRows({
      status: { agentStatus: 'running' },
      node: { scope: 'agent', title: '页面设计', status: 'in_progress' },
      now: NOW,
    });
    expect(agentRows[0].label).toBe('当前节点');
    expect(agentRows[0].scopeBadge).toBeUndefined();

    // 缺项即少一行：没有 lastRunAt/lastFinishAt 就不该出现时长行。
    expect(buildPresenceRows({ status: {}, now: NOW })).toEqual([]);
  });
});
