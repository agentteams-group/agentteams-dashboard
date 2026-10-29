'use client';

/**
 * Agent「此刻在做什么」悬浮卡（方案 v3 C-5）。
 *
 * 为什么单独成文件：MessageBubble 只管一条消息怎么摆，这张卡的内容全是
 * 「这个 Agent 此刻的运行事实」——Controller 心跳状态、本房间工作流节点、
 * HITL 待确认。让它自己订阅 store/hook，就不必给 MessageBubble 加 prop：
 * 加 prop 就得改 ChatRoom 的传参，而 C-3 刚交付的答复契约（onSendConfirmation
 * 四参签名）正挂在那条链上。
 *
 * 挂载条件：只有带 workerName 的头像（= 某个 Worker 发的消息）才挂。人类发送者
 * 和「我自己」的消息本来就没有运行时可报、头像也不可点，多包一层只会造出
 * 按不到的焦点位。
 *
 * 诚实性（本卡最重要的一条）：老版本 Controller 不回报 agentStatus /
 * runningTaskCount / lastRunAt / lastFinishAt（`useWorkerAgentStatusMap` 的
 * 注释写明「all fields undefined → falls back to typing + message age」）。
 * 因此：哪一项没有数据就少渲染那一行，绝不写「未知工具」这类填充话术；四项
 * 全缺时整张卡退化成一句「这个服务端没有回报该 Agent 的运行状态」。
 * 任务名同理：TaskEntry 没有「按 Agent 归属」的字段，能归属的只有
 * `steps[].assignedTo`（WorkflowItem）；对不上就退回房间级任务，并在标签上
 * 明写「本房间当前」，不假装那是这个 Agent 的节点。
 *
 * 交互：hover 或键盘聚焦头像打开，Esc / 移出 / 点到别处关闭。卡挂在
 * `PopoverAnchor` 上而不是 `PopoverTrigger` 上 —— Trigger 会在按钮的 click 上
 * 叠一层「开合卡片」，触屏下点头像就得两下才生效；Anchor 只负责定位，头像
 * 原有的「打开该 Worker 的只读会话」这一点没动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useSessionTick, useWorkerAgentStatusMap } from '@/hooks/use-worker-session-state';
import type { WorkerAgentStatusInfo, WorkerSessionState } from '@/lib/worker-session-state';
import { selectTaskList, useTaskStore } from '@/lib/task-store';
import { selectConfirmationList, useHitlInboxStore } from '@/lib/hitl-inbox';
import { getProjectWorkflow } from '@/lib/agentteams-projects-api';
import { isProjectMiss, workflowLiveFromProject } from '@/lib/chat-workflow-live';
import type { WorkflowItem } from '@/lib/a2ui/workflow';
import { formatAgoZh, formatDurationZh } from '@/lib/worker-activity';
import { PHASE_STATUS_TOKEN, statusBadgeClass } from '@/lib/status-tokens';
import type { StatusToken } from '@/lib/status-tokens';
import { roomHash, tasksHash } from '@/lib/nav-hash';

/** 指针从头像移到卡片之间留一点余量，否则鼠标一走到卡上就关了。 */
const HOVER_CLOSE_GRACE_MS = 150;

/** 卡片里的一行（标签 + 已组好中文措辞的值）；没有数据的行不会进数组。 */
export interface PresenceRow {
  label: string;
  value: string;
  /** 行尾徽章文字（可选）。 */
  badge?: string;
  /** 徽章用语义状态 token 配色，缺省按 info。 */
  token?: StatusToken;
  /**
   * 归属降级标记（可选，固定 info 配色）：这一行的数据不是按 Agent 归属来的。
   * 波二出口判据是「降级全部有徽标」，所以只写「本房间当前」的文案不算过关——
   * 扫一眼行尾就得能看出这是房间的数据、不是这个 Agent 的。
   */
  scopeBadge?: { label: string; title: string };
}

const ROOM_SCOPE_BADGE = {
  label: '房间级',
  title:
    '这个任务没有按 Agent 归属的字段（TaskEntry 只有 steps[].assignedTo / subagents[].assignedTo 能对上），对不上时只能给房间级数据',
};

/** 当前节点/任务名。scope 决定标签措辞，不骗用户。 */
export interface PresenceNode {
  scope: 'agent' | 'room';
  title: string;
  status?: string;
}

const ACTIVE_NODE_STATUSES = new Set(['running', 'in_progress', 'active']);
const DONE_NODE_STATUSES = new Set(['done', 'completed', 'success', 'succeeded']);
const FAILED_NODE_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled', 'aborted']);
const BLOCKED_NODE_STATUSES = new Set(['blocked', 'paused', 'on_hold']);

const NODE_STATUS_ZH: Record<string, string> = {
  running: '进行中',
  in_progress: '进行中',
  active: '进行中',
  done: '已完成',
  completed: '已完成',
  success: '已完成',
  succeeded: '已完成',
  failed: '失败',
  error: '失败',
  cancelled: '已取消',
  canceled: '已取消',
  aborted: '已中止',
  blocked: '已阻塞',
  paused: '已暂停',
  on_hold: '挂起',
  pending: '等待中',
  queued: '排队中',
};

/** Controller 心跳的 agentStatus 取值（idle/running/disabled）。 */
const AGENT_STATUS_ZH: Record<string, string> = {
  running: '运行中',
  idle: '空闲',
  disabled: '已停用',
};

const SESSION_STATE_ZH: Record<WorkerSessionState, string> = {
  running: '运行中',
  done: '刚完成',
  idle: '空闲',
};

const SESSION_STATE_TOKEN: Record<WorkerSessionState, StatusToken> = {
  running: 'running',
  done: 'done',
  idle: 'info',
};

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * 节点责任人是否就是这个 Worker。上游有两种写法：显示名（`designer`）和
 * Matrix 形态（`@designer:server`），后者取 localpart 再比。
 */
export function assignedToMatches(assignedTo: string | undefined, workerName: string): boolean {
  const a = normalize(assignedTo);
  if (!a) return false;
  const w = normalize(workerName);
  if (!w) return false;
  if (a === w) return true;
  if (!a.startsWith('@')) return false;
  return a.slice(1).split(':')[0] === w;
}

function nodeTitle(step: WorkflowItem): string {
  return step.title || step.name || step.id || '未命名节点';
}

function nodeToken(status: string | undefined): StatusToken {
  const s = normalize(status);
  if (ACTIVE_NODE_STATUSES.has(s)) return 'running';
  if (DONE_NODE_STATUSES.has(s)) return 'done';
  if (FAILED_NODE_STATUSES.has(s)) return 'failed';
  if (BLOCKED_NODE_STATUSES.has(s)) return 'blocked';
  return 'waiting';
}

function nodeBadge(status: string | undefined): string {
  const s = normalize(status);
  return NODE_STATUS_ZH[s] ?? (s || '未知');
}

/** 这个 Agent 名下的节点：优先仍在执行的那一个，其次它名下第一条。 */
export function pickAgentNode(
  steps: readonly WorkflowItem[],
  workerName: string,
): PresenceNode | null {
  const owned = steps.filter((step) => assignedToMatches(step.assignedTo, workerName));
  if (owned.length === 0) return null;
  const active = owned.find((step) => ACTIVE_NODE_STATUSES.has(normalize(step.status)));
  const picked = active ?? owned[0];
  return { scope: 'agent', title: nodeTitle(picked), status: picked.status };
}

export interface PresenceRowInput {
  /** Controller 心跳里的该 Agent 状态；老服务端整片缺失。 */
  status?: WorkerAgentStatusInfo & { phase?: string };
  node?: PresenceNode | null;
  /** 这个 Agent 引起的待确认工具名。 */
  pendingToolName?: string | null;
  now: number;
}

/**
 * 四行数据的装配规则：缺项即少一行。
 * 「当前工具」这一位只在真的有工具名（HITL 待确认）时才叫工具；
 * 否则退成心跳回报的运行时信息，两者都没有就不出现这一行。
 */
export function buildPresenceRows({
  status,
  node,
  pendingToolName,
  now,
}: PresenceRowInput): PresenceRow[] {
  const rows: PresenceRow[] = [];

  if (node) {
    rows.push({
      label: node.scope === 'agent' ? '当前节点' : '本房间当前',
      value: node.title,
      ...(node.status ? { badge: nodeBadge(node.status), token: nodeToken(node.status) } : {}),
      ...(node.scope === 'room' ? { scopeBadge: ROOM_SCOPE_BADGE } : {}),
    });
  }

  if (pendingToolName) {
    rows.push({ label: '等待确认', value: pendingToolName, badge: 'HITL', token: 'waiting' });
  } else if (status) {
    const parts: string[] = [];
    if (status.agentStatus) {
      parts.push(AGENT_STATUS_ZH[normalize(status.agentStatus)] ?? status.agentStatus);
    }
    if (typeof status.runningTaskCount === 'number' && status.runningTaskCount > 0) {
      parts.push(`${status.runningTaskCount} 个任务在跑`);
    }
    if (parts.length > 0) rows.push({ label: '运行时', value: parts.join(' · ') });
  }

  const running = status?.lastRunAt ? formatDurationZh(status.lastRunAt, now) : null;
  if (running) rows.push({ label: '已运行', value: `运行了 ${running}` });

  const finished = status?.lastFinishAt ? formatAgoZh(status.lastFinishAt, now) : null;
  if (finished) rows.push({ label: '最近状态变更', value: `${finished}完成` });

  return rows;
}

export interface AgentPresenceCardProps {
  /** 该条消息发送者的 MXID：心跳状态表与 HITL 都按它归人。 */
  sender: string;
  /** 拥有这条消息的 Worker 名；空 = 人类/未知发送者，不挂卡。 */
  workerName?: string;
  /** 头像旁的显示名，卡片标题沿用，避免两处不同叫法。 */
  senderLabel: string;
  /** ChatRoom 已算好的三态会话点；仅在服务端没回报阶段时作补充说明。 */
  senderStatus?: WorkerSessionState | null;
  /** 头像本体（MessageBubble 里那个按钮，点击行为原封不动）。 */
  children: ReactNode;
}

/**
 * 外层只决定「挂不挂」，不碰任何订阅：人类发送者直接原样输出 children，
 * 于是 MessageBubble 挂载这张卡不带 react-query 依赖（QueryClientProvider
 * 缺失的旧测试页不会被拖下水）。
 */
export function AgentPresenceCard({
  sender,
  workerName,
  senderLabel,
  senderStatus,
  children,
}: AgentPresenceCardProps) {
  if (!workerName) return <>{children}</>;
  return (
    <PresenceCardHost
      sender={sender}
      workerName={workerName}
      senderLabel={senderLabel}
      senderStatus={senderStatus}
    >
      {children}
    </PresenceCardHost>
  );
}

interface HostProps extends Required<Pick<AgentPresenceCardProps, 'sender' | 'workerName' | 'senderLabel'>> {
  senderStatus?: AgentPresenceCardProps['senderStatus'];
  children: ReactNode;
}

/**
 * 交互外壳：只管开合，不订阅任何数据。
 *
 * 卡片内容（`PresenceCard`）只在打开时才挂载，所以心跳查询、任务表和项目
 * overlay 这些 react-query 订阅都发生在用户真的看了这一眼之后——常驻在每条
 * 消息的头像上不现实（一个房间几十条消息就是几十份订阅）。
 */
function PresenceCardHost({ sender, workerName, senderLabel, senderStatus, children }: HostProps) {
  const [open, setOpen] = useState(false);
  /**
   * 打开来源：键盘打开才把焦点送进卡片，hover 打开时抢焦点会很吵。
   * 用 state 不用 ref——它直接决定卡片渲染时的 autoFocus，而渲染期读 ref
   * 是 react-hooks/refs 的 error（本仓该规则不容豁免）。
   */
  const [openedBy, setOpenedBy] = useState<'pointer' | 'keyboard'>('pointer');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_GRACE_MS);
  }, [cancelClose]);

  const closeNow = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  const openBy = useCallback(
    (source: 'pointer' | 'keyboard') => {
      cancelClose();
      setOpenedBy(source);
      setOpen(true);
    },
    [cancelClose],
  );

  // 外壳可能在计时器还挂着时被卸载（切房间、消息被 m.replace 重排）。
  useEffect(() => cancelClose, [cancelClose]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          cancelClose();
          setOpen(true);
          return;
        }
        closeNow();
      }}
    >
      <PopoverAnchor asChild>
        <div
          onMouseEnter={() => openBy('pointer')}
          onMouseLeave={scheduleClose}
          onFocus={() => openBy('keyboard')}
          onBlur={(event) => {
            // 键盘打开后 Radix 把焦点交给卡片里的链接，头像的 blur 不算「离开」。
            const next = event.relatedTarget as Node | null;
            if (next && contentRef.current?.contains(next)) return;
            scheduleClose();
          }}
          // 触屏/鼠标点头像仍是原来那一下（打开该 Worker 的只读会话）：
          // 卡片跟着叠在上面只会挡住面板，所以点下去就把卡关掉。
          onClick={closeNow}
        >
          {children}
        </div>
      </PopoverAnchor>
      {open && (
        <PresenceCard
          sender={sender}
          workerName={workerName}
          senderLabel={senderLabel}
          senderStatus={senderStatus}
          autoFocusLink={openedBy === 'keyboard'}
          contentRef={contentRef}
          onArrive={cancelClose}
          onDepart={scheduleClose}
          onClose={closeNow}
        />
      )}
    </Popover>
  );
}

interface PresenceCardContentProps {
  sender: string;
  workerName: string;
  senderLabel: string;
  senderStatus?: AgentPresenceCardProps['senderStatus'];
  /** 键盘打开时把焦点交给卡内链接，鼠标 hover 不抢焦点。 */
  autoFocusLink: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  /** 指针移进卡片：取消待关闭计时。 */
  onArrive: () => void;
  /** 指针移出 / 焦点离开卡片：延后关闭（留出从头像走到卡上的余量）。 */
  onDepart: () => void;
  onClose: () => void;
}

/**
 * 标题旁的阶段 chip：优先 Controller 回报的容器阶段；老服务端没有阶段字段时
 * 退成 ChatRoom 已算好的三态会话点，并在 title 里写明这是「按输入状态与最近
 * 消息推断」，不冒充服务端回报。四项数据全缺时（见下面的降级）整张卡不渲染它，
 * 免得「运行中」和「服务端没回报状态」同屏自相矛盾。
 */
function buildHeaderChip(
  status: (WorkerAgentStatusInfo & { phase?: string }) | undefined,
  senderStatus?: AgentPresenceCardProps['senderStatus'],
): { label: string; token: StatusToken; title: string } | null {
  if (status?.phase) {
    return {
      label: status.phase,
      token: PHASE_STATUS_TOKEN[status.phase] ?? 'info',
      title: '容器阶段（Controller 回报）',
    };
  }
  if (senderStatus) {
    return {
      label: SESSION_STATE_ZH[senderStatus],
      token: SESSION_STATE_TOKEN[senderStatus],
      title: '按输入状态与最近消息推断（服务端未回报阶段）',
    };
  }
  return null;
}

/**
 * 卡片内容层：数据全部自取，不要求 MessageBubble/ChatRoom 多传任何 prop。
 * 只有外壳把卡打开时才挂载，所以这里的心跳表、任务表与项目 overlay 订阅
 * 都是「用户真的看了这一眼」之后才存在。
 */
function PresenceCard({
  sender,
  workerName,
  senderLabel,
  senderStatus,
  autoFocusLink,
  contentRef,
  onArrive,
  onDepart,
  onClose,
}: PresenceCardContentProps) {
  // 共享 60s 时钟（与状态点同一口径）：时长/「X 分钟前」随它一起走，
  // 卡片不自己开定时器。
  const now = useSessionTick();
  // 心跳状态表按 MXID 归人；老 Controller 的条目字段全 undefined。
  const status = useWorkerAgentStatusMap()[sender];
  const roomId = useRoomMetaStore((s) => s.activeRoomId) ?? undefined;
  const tasks = useTaskStore((s) => s.tasks);
  const confirmations = useHitlInboxStore((s) => s.confirmations);

  // 本房间最近一次更新的工作流消息（TaskStore 由全局 /sync 写入）。房间级：
  // 底座没有「按 Agent 查任务」的服务端接口，能归属的只有节点上的 assignedTo。
  const roomTask = useMemo(() => {
    if (!roomId) return undefined;
    return selectTaskList(tasks).find((task) => task.roomId === roomId);
  }, [tasks, roomId]);

  // 项目正源 overlay（节点名 / 责任人 / 节点状态）。queryKey 与接力卡和
  // RoomTasksPanel 完全一致 → 同房间命中同一份缓存，不新增一轮轮询；
  // runId 不是项目（404/409/400）→ isProjectMiss 停探，回退消息快照。
  const { data: project } = useQuery({
    queryKey: ['chat-workflow-live', String(roomTask?.runId ?? '')],
    queryFn: () => getProjectWorkflow(String(roomTask?.runId), { includeTasks: true }),
    enabled: !!roomTask?.runId,
    retry: false,
    staleTime: 5000,
    refetchInterval: (query) => (isProjectMiss(query.state.error) ? false : 15_000),
  });
  // overlay 解算放进下面的 useMemo：workflowLiveFromProject 每轮都返回新对象，
  // 放外面会让下游 memo 每轮重算（exhaustive-deps 也是这么报的）。

  // 待确认工具：只认「这个 Agent 引起」的那些（事件发送者就是它，或
  // triggeredBy 写了它的名字）；别人的待确认不该出现在它的卡上。
  const pendingToolName = useMemo(() => {
    if (!roomId) return null;
    const mine = selectConfirmationList(confirmations).find(
      (item) => item.roomId === roomId && (item.sender === sender || assignedToMatches(item.triggeredBy, workerName)),
    );
    return mine?.toolName ?? null;
  }, [confirmations, roomId, sender, workerName]);

  const enriched = useMemo(() => {
    const live = project ? workflowLiveFromProject(project) : null;
    const steps = live && live.steps.length > 0 ? live.steps : (roomTask?.steps ?? []);
    const owned = pickAgentNode(steps, workerName);
    if (owned) return { node: owned, projectId: live?.projectId };
    // 归属不上就老实给房间级，并让 buildPresenceRows 挂上「房间级」徽标。
    const roomNode: PresenceNode | null = roomTask
      ? { scope: 'room', title: roomTask.title, status: roomTask.status }
      : null;
    return { node: roomNode, projectId: live?.projectId };
  }, [project, roomTask, workerName]);

  const rows = useMemo(
    () => buildPresenceRows({ status, node: enriched.node, pendingToolName, now }),
    [status, enriched.node, pendingToolName, now],
  );

  // 一条直达链接：项目 overlay 认出来的 project_id 最可信，其次用房间任务的
  // runId（项目工作流卡的 runId 就是项目 id；workerflow 的 run-xxxx 认不出来时，
  // 任务看板按 isStaleProjectSelection 忽略未知选中，落点是「打开看板」）。
  const link = useMemo(() => {
    const projectTarget = enriched.projectId ?? roomTask?.runId;
    if (projectTarget) return { hash: tasksHash(projectTarget), label: '在任务看板打开' };
    if (roomId) return { hash: roomHash(roomId), label: '在本空间查看' };
    return null;
  }, [enriched.projectId, roomTask?.runId, roomId]);

  const chip = rows.length > 0 ? buildHeaderChip(status, senderStatus) : null;

  return (
    <PopoverContent
      ref={contentRef}
      side="right"
      align="start"
      sideOffset={8}
      collisionPadding={12}
      onMouseEnter={onArrive}
      onMouseLeave={onDepart}
      onBlur={onDepart}
      // 焦点交给卡内链接由 autoFocusLink 决定（见 CardProps），不让 Radix
      // 在 hover 打开时抢走焦点——那会让每条消息的鼠标悬停都在跳焦点。
      onOpenAutoFocus={(event) => event.preventDefault()}
      className="w-72 max-w-[85vw] p-3"
      data-presence-card={workerName}
    >
      <div className="flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={workerName}>
          {senderLabel}
        </p>
        {chip && (
          <Badge variant="outline" className={statusBadgeClass(chip.token)} title={chip.title}>
            {chip.label}
          </Badge>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          这个服务端没有回报该 Agent 的运行状态
        </p>
      ) : (
        <>
          <dl className="mt-2 space-y-1.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-muted-foreground">{row.label}</dt>
                <dd className="flex min-w-0 items-baseline justify-end gap-1.5">
                  <span className="min-w-0 truncate text-sm" title={row.value}>
                    {row.value}
                  </span>
                  {row.badge && (
                    <Badge variant="outline" className={statusBadgeClass(row.token ?? 'info')}>
                      {row.badge}
                    </Badge>
                  )}
                  {row.scopeBadge && (
                    <Badge variant="outline" className={statusBadgeClass('info')} title={row.scopeBadge.title}>
                      {row.scopeBadge.label}
                    </Badge>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {link && (
            <a
              href={link.hash}
              onClick={(event) => {
                // 单一导航路径约定（与 mobile-quick-bar / header 同一口径）：
                // 只写 hash，剩下的交给 use-active-section 的 hashchange 解析，
                // 卡片自己绝不调 setActiveSection。href 仍然保留，右键拷贝链接
                // 和禁用 JS 时都指向同一个落点。
                event.preventDefault();
                window.location.hash = link.hash;
                onClose();
              }}
              autoFocus={autoFocusLink}
              className="mt-2.5 inline-flex items-center gap-1.5 self-start rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{link.label}</span>
            </a>
          )}
        </>
      )}
    </PopoverContent>
  );
}
