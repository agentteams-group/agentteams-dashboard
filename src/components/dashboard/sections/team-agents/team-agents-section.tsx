'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Crown,
  Info,
  Plus,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import { StatusDot } from '@/components/dashboard/status-dot';
import { WorkerSessionDot } from '@/components/worker-session-dot';
import { useCreateTeam, useCreateWorker } from '@/hooks/use-agentteams-mutations';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useModelSelection } from '@/hooks/use-model-selection';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useWorkerSessionState } from '@/hooks/use-worker-session-state';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSearch } from '@/lib/search-context';
import { currentHashParams, hashForSection } from '@/lib/nav-hash';
import { agentteamsApi } from '@/lib/agentteams-api';
import type {
  CreateTeamRequest,
  CreateWorkerRequest,
  ManagerResponse,
  TeamResponse,
  WorkerResponse,
} from '@/lib/agentteams-api';
import { ManagerDetailDialog } from './manager-detail-dialog';
import { TeamCreateDialog } from '../teams/team-create-dialog';
import { TeamDetailDialog } from './team-detail-dialog';
import { MillforgeDialog } from '../teams/millforge/millforge-dialog';
import { standaloneWorkers as computeStandaloneWorkers } from '../teams/team-drawer-logic';
import { WorkerCreateDialog } from '../workers/worker-create-dialog';
import { WorkerDetailDialog } from './worker-detail-dialog';
import { InteractiveTeamTopology } from './interactive-team-topology';
import { EntityInspector, type EntityInspectorEntity } from './entity-inspector';
import {
  compareTeamRows,
  filterTeamRows,
  leaderWorker,
  layoutForWidth,
  shellGridClass,
  teamAgentCounts,
  teamAgentsInitialIntentFromHash,
  teamMembers,
  type TeamAgentRow,
  type TeamAgentsInitialIntent,
  type TeamAgentsLayout,
} from './team-agents-logic';

const EMPTY_TEAM: CreateTeamRequest = { name: '', leader: { name: '' }, workerNames: [] };
const EMPTY_WORKER: CreateWorkerRequest = { name: '', runtime: 'openclaw' };

/**
 * 统一选择（#233 F1：无页签、无「选择→抽屉」路径）——列表/拓扑里点谁，
 * 详情大弹窗就承载谁的唯一面板（TeamSettingsPanel / WorkerDetailPanel /
 * ManagerDetailPanel，单一实现）。
 */
type TeamAgentsSelection =
  | { kind: 'manager'; name: string }
  | { kind: 'team'; name: string }
  | { kind: 'worker'; name: string };

/**
 * R4 深链兼容：工作台可由四个 section id 挂入（team-agents / resources /
 * workers / teams）。挂载时从 hash 捕获进来的 id，后续 hash 写入以它为准，
 * 避免 motion.div key={activeSection} 因我们的写入而切换、整树 remount
 * 冲掉初始选中。
 */
function workbenchSectionIdFromHash(hash: string): string {
  const path = hash.replace(/^#/, '').split('?')[0];
  if (path === 'workers' || path === 'console/resources/workers') return 'workers';
  if (path === 'teams' || path === 'console/resources/teams') return 'teams';
  if (path === 'console/resources') return 'resources';
  return 'team-agents';
}

/** 本页消费的深链参数（#251 口径 + A4 的 manager / panel + R3 的 inspect）。 */
const WORKBENCH_DEEPLINK_PARAMS = ['team', 'agent', 'manager', 'edit', 'panel', 'inspect'] as const;

/**
 * A2 容器宽度断点：ResizeObserver 量壳的宽度（不是 window.innerWidth——
 * 侧栏折叠 / 容器限宽时两者不一致）。jsdom 无 ResizeObserver → 回落
 * window 宽度 + resize 监听。
 */
function useTeamAgentsLayout<T extends HTMLElement>(containerRef: React.RefObject<T | null>): TeamAgentsLayout {
  // SSR 首帧固定 triple（服务端/客户端一致），挂载后按实测宽度切换。
  const [layout, setLayout] = useState<TeamAgentsLayout>('triple');
  useEffect(() => {
    const node = containerRef.current;
    if (typeof ResizeObserver === 'undefined' || !node) {
      const sync = () => setLayout(layoutForWidth(window.innerWidth));
      sync();
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setLayout(layoutForWidth(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);
  return layout;
}

/**
 * 团队行「待决策」计数（A1）：插件用一次聚合请求（attentionPendingByRoom），
 * Dashboard 代理只有按团队的 GET /teams/{name}/attention —— 逐队懒查，
 * 30s 缓存不轮询；404（旧控制器未部署）= 无数据，整枚徽章不显（诚实降级）。
 */
function useTeamAttentionCount(teamName: string): number {
  const { data } = useQuery({
    queryKey: ['agentteams-team-attention', teamName],
    queryFn: () => agentteamsApi.getTeamAttention(teamName),
    enabled: Boolean(teamName),
    staleTime: 30_000,
    retry: 1,
    throwOnError: false,
  });
  return data?.count ?? 0;
}

function Pane({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card ${className}`}
    >
      {children}
    </section>
  );
}

function PaneHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
      <h2 className="truncate text-sm font-semibold">{title}</h2>
      {meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
    </div>
  );
}

/** A2：Manager 行（与团队「一个等级」；紫 M 头像 + runtime·model + 状态灯）。 */
function ManagerRow({
  manager,
  selected,
  onSelect,
}: {
  manager: ManagerResponse;
  selected: boolean;
  onSelect: (_manager: ManagerResponse) => void;
}) {
  return (
    <button
      type="button"
      data-manager-name={manager.name}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(manager)}
      className={`flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        selected
          ? 'border-violet-500/60 bg-violet-500/10'
          : 'border-border/60 bg-muted/20 hover:bg-muted/50'
      }`}
    >
      <Avatar className="size-7 shrink-0 rounded-md">
        <AvatarFallback className="rounded-md bg-gradient-to-br from-violet-600 to-violet-400 text-white">
          <Crown className="size-3.5" aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-semibold">{manager.name}</span>
          <Badge
            variant="outline"
            className="shrink-0 border-violet-500/40 bg-violet-500/10 text-xs text-violet-600 dark:text-violet-400"
          >
            Manager
          </Badge>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {manager.runtime || 'qwenpaw'} · {manager.model || '-'}
        </span>
      </span>
      <StatusDot phase={manager.state} />
    </button>
  );
}

/**
 * A1：团队行——头像（leader 首字母兜底）+ 名 + leader 会话灯（A5）+
 * 待决策徽章 + 成员/休眠/异常计数 + 匹配成员提示 + 选中态。
 */
function TeamListRow({
  row,
  workers,
  selected,
  onSelect,
}: {
  row: TeamAgentRow;
  workers: WorkerResponse[] | undefined;
  selected: boolean;
  onSelect: (_team: TeamResponse) => void;
}) {
  const { team, matchedMembers } = row;
  const members = useMemo(() => teamMembers(team, workers), [team, workers]);
  const counts = useMemo(() => teamAgentCounts(members), [members]);
  const leader = useMemo(() => leaderWorker(team, workers), [team, workers]);
  const sessionState = useWorkerSessionState({
    matrixUserID: leader?.matrixUserID,
    roomID: leader?.roomID,
    phase: leader?.phase,
  });
  const attentionCount = useTeamAttentionCount(team.name);
  const memberTotal = team.workerNames?.length || team.totalWorkers;

  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(team)}
        className={`flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          selected ? 'bg-primary/10' : 'hover:bg-muted/50'
        }`}
      >
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="bg-muted text-xs">
            {leader ? leader.name.slice(0, 1).toUpperCase() : <Users className="size-3.5" aria-hidden="true" />}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium">{team.name}</span>
            {leader && <WorkerSessionDot state={sessionState} />}
            {attentionCount > 0 && (
              <Badge
                variant="outline"
                className="shrink-0 border-amber-500/40 bg-amber-500/10 text-xs text-amber-600 dark:text-amber-400"
              >
                待决策 {attentionCount}
              </Badge>
            )}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            <span>成员 {memberTotal}</span>
            {counts.sleeping > 0 && (
              <Badge variant="outline" className="shrink-0 px-1.5 text-xs">
                休眠 {counts.sleeping}
              </Badge>
            )}
            {counts.abnormal > 0 && (
              <Badge
                variant="outline"
                className="shrink-0 border-destructive/40 bg-destructive/10 px-1.5 text-xs text-destructive"
              >
                异常 {counts.abnormal}
              </Badge>
            )}
            {matchedMembers.length > 0 && (
              <span className="min-w-0 truncate text-primary">
                匹配成员：{matchedMembers.join('、')}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

/** A5：独立 Worker 行（会话灯在名字前；未派生不渲染）。 */
function StandaloneWorkerRow({
  worker,
  selected,
  onSelect,
}: {
  worker: WorkerResponse;
  selected: boolean;
  onSelect: (_worker: WorkerResponse) => void;
}) {
  const sessionState = useWorkerSessionState({
    matrixUserID: worker.matrixUserID,
    roomID: worker.roomID,
    phase: worker.phase,
  });
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(worker)}
      className={`flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        selected ? 'bg-primary/10' : 'hover:bg-muted/50'
      }`}
    >
      {worker.matrixUserID ? <WorkerSessionDot state={sessionState} /> : null}
      <span className="min-w-0 truncate text-foreground">{worker.name}</span>
    </button>
  );
}

/** A4：列表底部「未归属团队的 Worker（N）」可折叠行（空 = 不渲染）。 */
function StandaloneWorkersRow({
  workers,
  selectedName,
  expanded,
  onToggle,
  onSelect,
}: {
  workers: WorkerResponse[];
  selectedName: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (_worker: WorkerResponse) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed p-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 truncate">未归属团队的 Worker（{workers.length}）</span>
        {expanded ? (
          <ChevronDown className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className="space-y-0.5 p-1.5">
          <p className="px-1 text-xs text-muted-foreground">
            独立 Worker——能运行、能被私聊，不参与团队任务；点名字看详情，在团队设置里可加进团队。
          </p>
          {workers.map((worker) => (
            <StandaloneWorkerRow
              key={worker.name}
              worker={worker}
              selected={selectedName === worker.name}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 选中独立 Worker 时的中栏上下文卡（替代「团队不存在」空态）。 */
function StandaloneWorkerContextCard({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <div className="space-y-2.5 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
        <Badge variant="outline" className="shrink-0 text-xs">
          未归属团队
        </Badge>
      </div>
      <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-2 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0">
          该 Worker 未归属任何团队（独立 Worker）：能运行、能被私聊，但不参与团队任务。
          <span className="mt-1 block text-muted-foreground">
            加进团队：打开目标团队 → 团队设置 →「加入 Worker」一键加入。
          </span>
        </p>
      </div>
      <Button size="sm" variant="outline" className="min-h-11 text-xs sm:min-h-9" onClick={onBack}>
        回团队列表
      </Button>
    </div>
  );
}

/** A6：选中项已从数据中消失（刷新后改名/删除）→ 回落引导。 */
function StaleSelectionState({
  text,
  buttonLabel,
  onBack,
}: {
  text: string;
  buttonLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <AlertTriangle className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-xs text-muted-foreground">{text}</p>
      <Button size="sm" variant="outline" className="min-h-11 text-xs sm:min-h-9" onClick={onBack}>
        {buttonLabel}
      </Button>
    </div>
  );
}

/**
 * 「团队与 Agent」工作台（#233 三栏工作台 − 右侧详情栏 + R2 详情大弹窗）。
 *
 * 列表（F1 无页签）：Manager 行（仅 L1 可见）+ 团队行（leader 名排序）+
 * 底部「未归属团队的 Worker」折叠行；中间 = InteractiveTeamTopology。
 * 详情不再占栏：团队（拓扑头部齿轮，R2 单一入口）、Agent
 * （拓扑成员行 / 独立 Worker 行）、Manager（列表 Manager 行）各自打开
 * 承载当前 main 版面板的自适应大弹窗（见 *-detail-dialog.tsx）。
 * dual 断点下 Inspector 走右侧真 Sheet 抽屉（R3：Esc / 遮罩只关抽屉，
 * 保留选中；URL ?inspect=1 反映开合）。
 *
 * 布局：≥1024 列表 + 拓扑两栏；narrow <1024 单栏，列表 ↔ 拓扑切换
 * （拓扑内「团队列表」返回）。
 */
export function TeamAgentsSection() {
  const { data: teams, isLoading, isError, refetch, isRefetching } = useTeams();
  const { data: workers } = useWorkers();
  const { data: managers } = useManagers();
  const { searchQuery } = useSearch();
  const { isConnected, userLevel } = useAgentTeamsStore();
  const { options: modelOptions, sessionIssue } = useModelSelection();
  const queryClient = useQueryClient();
  // A2：壳自身作为测量容器（断点跟容器宽度走，不跟 window 走）。
  const shellRef = useRef<HTMLDivElement>(null);
  const layout = useTeamAgentsLayout(shellRef);

  const createTeam = useCreateTeam();
  const createWorker = useCreateWorker();

  // A7：旧 ?tab= / workers / teams 深链 → 一次性初始选择意图（无页签 UI）。
  const initialIntent = useRef<TeamAgentsInitialIntent>(
    typeof window === 'undefined' ? 'teams' : teamAgentsInitialIntentFromHash(window.location.hash),
  );
  // 本页消费的深链参数（?team= / ?agent= / ?edit=）。首帧捕获一次——
  // 早于任何 hash 同步写入把它们剥掉。
  const initialParams = useRef<URLSearchParams | null | undefined>(undefined);
  if (initialParams.current === undefined) {
    initialParams.current = typeof window === 'undefined' ? null : currentHashParams();
  }
  const initialApplied = useRef(false);
  // R4：从四个工作台 id 中的哪一个进来（见 workbenchSectionIdFromHash）。
  const sectionId = useRef<string | null>(null);
  if (sectionId.current === null) {
    sectionId.current =
      typeof window === 'undefined' ? 'team-agents' : workbenchSectionIdFromHash(window.location.hash);
  }

  // A4：最新状态 refs——hashchange 监听绑定一次，读这些 ref 而不是闭包
  // 旧值，做「自身写入的 echo」判定（派生状态 === 当前状态 → no-op）。
  // 赋值在下方 state 声明之后（避免 TDZ）。
  const selectionRef = useRef<TeamAgentsSelection | null>(null);
  const detailOpenRef = useRef(false);
  const dialogPanelRef = useRef<string | null>(null);
  const layoutRef = useRef<TeamAgentsLayout>('triple');
  const standaloneRef = useRef<WorkerResponse[]>([]);
  const drawerOpenRef = useRef(false);

  const [selection, setSelection] = useState<TeamAgentsSelection | null>(null);
  const [narrowView, setNarrowView] = useState<'list' | 'topology'>('list');
  const [standaloneExpanded, setStandaloneExpanded] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  // A3：当前大弹窗应直达的分区 id（Inspector 分区按钮 / 齿轮写 'basic'，
  // 深链 ?panel= 写入）；null = 弹窗落在面板默认分区。
  const [dialogPanel, setDialogPanel] = useState<string | null>(null);
  // R3：dual 抽屉（真 Sheet）开合——Esc / 遮罩 / X 只关抽屉，保留选中；
  // 再点同一行一键重开（选择变化 effect 负责）。
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [newTeam, setNewTeam] = useState<CreateTeamRequest>(EMPTY_TEAM);
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false);
  const [newWorker, setNewWorker] = useState<CreateWorkerRequest>(EMPTY_WORKER);
  const [millforgeTeam, setMillforgeTeam] = useState<TeamResponse | null>(null);

  // A4：refs 赋值（渲染体同步，供 hashchange 监听读最新值）。
  selectionRef.current = selection;
  detailOpenRef.current = detailOpen;
  dialogPanelRef.current = dialogPanel;
  layoutRef.current = layout;
  drawerOpenRef.current = drawerOpen;

  // 数据到位后应用一次初始选择：?manager= > ?agent= > ?team= 深链优先
  // （#251「选中资源与编辑意图」+ A5 manager 深链），再按意图兜底
  // （teams → 首个团队；agents → 展开独立行选首个独立 Worker）。
  // edit=true 时同时记 ?panel= 直达分区（A3）。
  useEffect(() => {
    if (initialApplied.current || !teams) return;
    const params = initialParams.current ?? undefined;
    const managerParam = params?.get('manager');
    const teamParam = params?.get('team');
    const agentParam = params?.get('agent');
    const editIntent = params?.get('edit') === 'true';
    const panelParam = params?.get('panel');

    if (managerParam && (managers ?? []).some((item) => item.name === managerParam)) {
      setSelection({ kind: 'manager', name: managerParam });
      if (editIntent) {
        setDialogPanel(panelParam ?? null);
        setDetailOpen(true);
      }
      initialApplied.current = true;
      return;
    }
    if (teamParam && teams.some((team) => team.name === teamParam)) {
      setSelection({ kind: 'team', name: teamParam });
      if (editIntent) {
        setDialogPanel(panelParam ?? null);
        setDetailOpen(true);
      }
      initialApplied.current = true;
      return;
    }
    if (agentParam && (workers ?? []).some((item) => item.name === agentParam)) {
      const isStandalone = computeStandaloneWorkers(teams, workers ?? []).some(
        (item) => item.name === agentParam,
      );
      if (isStandalone) setStandaloneExpanded(true);
      setSelection({ kind: 'worker', name: agentParam });
      if (editIntent) {
        setDialogPanel(panelParam ?? null);
        setDetailOpen(true);
      }
      initialApplied.current = true;
      return;
    }

    const intent = initialIntent.current;
    if (intent === 'agents') {
      if (!workers) return;
      const first = computeStandaloneWorkers(teams, workers)[0] ?? workers[0];
      if (!first) {
        initialApplied.current = true;
        return;
      }
      setStandaloneExpanded(true);
      setSelection({ kind: 'worker', name: first.name });
      initialApplied.current = true;
      return;
    }
    const first = teams[0];
    if (!first) {
      initialApplied.current = true;
      return;
    }
    setSelection({ kind: 'team', name: first.name });
    initialApplied.current = true;
  }, [teams, workers, managers]);

  // A4：URL 状态的单一写入口——选择 / 弹窗 / 分区变化 → hash。
  // 以进来的 id 为基址（见 sectionId）：?tab= 保留初始深链的页签意图，
  // team / agent / manager 参数跟选择走，edit / panel 跟弹窗走。
  // 初始深链未消费前不写（避免抹掉还没读的参数）。
  useEffect(() => {
    if (typeof window === 'undefined' || !initialApplied.current) return;
    const base = hashForSection(sectionId.current ?? 'team-agents');
    const params = new URLSearchParams();
    const initialTab = initialParams.current?.get('tab') ?? null;
    if (initialTab) params.set('tab', initialTab);
    if (selection) {
      if (selection.kind === 'team') params.set('team', selection.name);
      else if (selection.kind === 'worker') params.set('agent', selection.name);
      else params.set('manager', selection.name);
    }
    if (selection && detailOpen) {
      params.set('edit', 'true');
      if (dialogPanel) params.set('panel', dialogPanel);
    }
    // R3：?inspect=1 反映 dual 抽屉开合（刷新 / 前进后退可还原）。
    if (selection && layout === 'dual' && drawerOpen) params.set('inspect', '1');
    const next = params.size > 0 ? `${base}?${params.toString()}` : base;
    if (window.location.hash !== `#${next}`) window.location.hash = next;
  }, [selection, detailOpen, dialogPanel, layout, drawerOpen]);

  // A4：外部 hash 变化（前进 / 后退、搜索深链、跨组件导航）→ 还原选择
  // 与弹窗状态。自身写入的 echo（派生状态 === 当前状态）no-op，不成环。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // 工作台可达的 hash 路径（canonical 合并页 / workers / teams 独立页 /
    // 裸 console/resources / 旧扁平路径）。
    const WORKBENCH_HASH_PATHS = new Set([
      'console/resources/team-agents',
      'console/resources/workers',
      'console/resources/teams',
      'console/resources',
      'workers',
      'teams',
    ]);
    const onHashChange = () => {
      const raw = window.location.hash.replace(/^#/, '');
      const sep = raw.indexOf('?');
      const path = sep === -1 ? raw : raw.slice(0, sep);
      if (!WORKBENCH_HASH_PATHS.has(path)) return;
      const params = new URLSearchParams(sep === -1 ? '' : raw.slice(sep + 1));
      const managerName = params.get('manager');
      const agentName = params.get('agent');
      const teamName = params.get('team');
      const editIntent = params.get('edit') === 'true';
      const panel = params.get('panel');
      // 期望选择：manager > agent > team > 未选中（取数据中仍存在的）。
      let desired: TeamAgentsSelection | null = null;
      if (managerName && (managers ?? []).some((item) => item.name === managerName)) {
        desired = { kind: 'manager', name: managerName };
      } else if (agentName && (workers ?? []).some((item) => item.name === agentName)) {
        desired = { kind: 'worker', name: agentName };
      } else if (teamName && (teams ?? []).some((item) => item.name === teamName)) {
        desired = { kind: 'team', name: teamName };
      }
      const current = selectionRef.current;
      const selectionChanged =
        (desired?.kind ?? null) !== (current?.kind ?? null) ||
        (desired?.name ?? null) !== (current?.name ?? null);
      if (selectionChanged) {
        setSelection(desired);
        // 单栏：钻取视图同步（manager → 列表，team / worker → 拓扑，
        // 未选中 → 列表）。
        if (layoutRef.current === 'single') {
          setNarrowView(desired ? (desired.kind === 'manager' ? 'list' : 'topology') : 'list');
        }
        if (
          desired?.kind === 'worker' &&
          standaloneRef.current.some((item) => item.name === desired.name)
        ) {
          setStandaloneExpanded(true);
        }
      }
      const openNow = editIntent && desired !== null;
      if (
        selectionChanged ||
        openNow !== detailOpenRef.current ||
        (openNow && panel !== dialogPanelRef.current)
      ) {
        setDetailOpen(openNow);
        setDialogPanel(openNow ? panel : null);
      }
      // R3：?inspect=1 → dual 抽屉开合（自身写入的 echo 时两值相等 → no-op）。
      const inspectNow =
        layoutRef.current === 'dual' && desired !== null && params.get('inspect') === '1';
      if (inspectNow !== drawerOpenRef.current) setDrawerOpen(inspectNow);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [teams, workers, managers]);

  // R3：dual 下有选中（进入 dual / 新选中 / 深链与 hashchange 还原）→ 开抽屉。
  // setSelection 总是产生新对象引用，故「关抽屉后再点同一行」也会触发
  // 重开；关抽屉本身不改 selection，不会触发本 effect。
  useEffect(() => {
    if (layout === 'dual' && selection !== null) setDrawerOpen(true);
  }, [layout, selection]);

  const refresh = useCallback(() => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
  }, [queryClient, refetch]);

  const teamRows = useMemo(() => {
    const rows = filterTeamRows(teams, workers, searchQuery);
    return [...rows].sort((a, b) => compareTeamRows(a, b, workers));
  }, [teams, workers, searchQuery]);

  const standalone = useMemo(
    () => computeStandaloneWorkers(teams, workers),
    [teams, workers],
  );
  standaloneRef.current = standalone;

  const selectedTeam = useMemo(
    () =>
      selection?.kind === 'team'
        ? (teams ?? []).find((team) => team.name === selection.name) ?? null
        : null,
    [teams, selection],
  );
  const selectedWorker = useMemo(
    () =>
      selection?.kind === 'worker'
        ? (workers ?? []).find((item) => item.name === selection.name) ?? null
        : null,
    [workers, selection],
  );
  const selectedManager = useMemo(
    () =>
      selection?.kind === 'manager'
        ? (managers ?? []).find((item) => item.name === selection.name) ?? null
        : null,
    [managers, selection],
  );

  // A3 右栏：当前选中项解析出的实体；解析不出 = 未选中占位。
  const inspectorEntity = useMemo<EntityInspectorEntity | null>(() => {
    if (selection?.kind === 'team' && selectedTeam) return { kind: 'team', team: selectedTeam };
    if (selection?.kind === 'worker' && selectedWorker) {
      const homeTeam =
        (teams ?? []).find(
          (team) => team.name === selectedWorker.team || team.teamName === selectedWorker.team,
        ) ?? null;
      return { kind: 'worker', worker: selectedWorker, homeTeam };
    }
    if (selection?.kind === 'manager' && selectedManager) {
      return { kind: 'manager', manager: selectedManager };
    }
    return null;
  }, [selection, selectedTeam, selectedWorker, selectedManager, teams]);

  // 行为矩阵（A2/A3）：多栏（triple / triple-compact / dual）行点击 =
  // 只选中（右栏 Inspector 接管详情，不弹大弹窗）；单栏（single）= 原有
  // 钻取（worker 点击开大弹窗；manager 点击开大弹窗；team 点击切拓扑）。
  const handleSelectTeam = useCallback((team: TeamResponse) => {
    setSelection({ kind: 'team', name: team.name });
    setDialogPanel(null);
    if (layout === 'single') {
      setNarrowView('topology');
      setDetailOpen(false);
    }
  }, [layout]);

  // 拓扑成员行 / 独立 Worker 行：多栏 = 选中（Inspector 展示）；
  // 单栏 = 选中 + 打开详情大弹窗。
  const handleOpenWorker = useCallback((worker: WorkerResponse) => {
    setSelection({ kind: 'worker', name: worker.name });
    if (layout === 'single') {
      setNarrowView('topology');
      setDetailOpen(true);
    } else {
      setDetailOpen(false);
      setDialogPanel(null);
    }
  }, [layout]);

  // 拓扑头部齿轮 / 显式「团队设置」按钮：选中团队 + 打开设置大弹窗
  // （落在「基本信息」分区）。
  const handleOpenTeamSettings = useCallback((team: TeamResponse) => {
    setSelection({ kind: 'team', name: team.name });
    if (layout === 'single') setNarrowView('topology');
    setDialogPanel('basic');
    setDetailOpen(true);
  }, [layout]);

  // Manager 行：多栏 = 选中（Inspector 展示）；单栏 = 选中 + 打开大弹窗。
  // 不切 narrow 视图，关弹窗后停在列表（拓扑引导空态不是更好的落点）。
  const handleSelectManager = useCallback((manager: ManagerResponse) => {
    setSelection({ kind: 'manager', name: manager.name });
    if (layout === 'single') {
      setDetailOpen(true);
    } else {
      setDetailOpen(false);
      setDialogPanel(null);
    }
  }, [layout]);

  // Inspector 分区按钮：打开大弹窗并直达该分区（panel 由写 effect 写
  // 进 URL ?panel=，刷新 / 回退可还原）。
  const handleOpenSection = useCallback((panel: string) => {
    setDialogPanel(panel);
    setDetailOpen(true);
  }, []);

  // 大弹窗开关：关闭时清分区（写 effect 会把 edit / panel 从 URL 剥掉）。
  const handleDetailOpenChange = useCallback((open: boolean) => {
    setDetailOpen(open);
    if (!open) setDialogPanel(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setDetailOpen(false);
    setDialogPanel(null);
    setDrawerOpen(false);
    setNarrowView('list');
  }, []);

  const handleDeleted = useCallback(() => {
    setDetailOpen(false);
    clearSelection();
  }, [clearSelection]);

  const handleCreateTeam = useCallback(() => {
    createTeam.mutate(newTeam, {
      onSuccess: (created) => {
        setCreateTeamOpen(false);
        setNewTeam(EMPTY_TEAM);
        if (created?.name) handleSelectTeam({ name: created.name } as TeamResponse);
      },
    });
  }, [createTeam, newTeam, handleSelectTeam]);

  const handleCreateWorker = useCallback(() => {
    createWorker.mutate(newWorker, {
      onSuccess: (created) => {
        setCreateWorkerOpen(false);
        setNewWorker(EMPTY_WORKER);
        if (created?.name) handleOpenWorker({ name: created.name } as WorkerResponse);
      },
    });
  }, [createWorker, newWorker, handleOpenWorker]);

  if (isError && !isConnected) {
    return <ApiErrorState />;
  }

  const hasSearch = searchQuery.trim().length > 0;
  const narrow = layout === 'single';
  const narrowTopology = narrow && narrowView === 'topology';
  const showList = !narrow || !narrowTopology;
  const showMain = !narrow || narrowTopology;
  // A2：断点定列（dual 的 Inspector 走右侧覆盖层，不占栅格列）。
  const gridClass = shellGridClass(layout);

  const narrowBack = narrow ? () => setNarrowView('list') : undefined;

  // 中栏拓扑：团队选中 → 该团队；成员 Worker → 所属团队（高亮行）；
  // 独立 Worker → 上下文卡；Manager / 未选 → 引导。
  let topology: React.ReactNode;
  if (selection?.kind === 'team') {
    topology = selectedTeam ? (
      <InteractiveTeamTopology
        team={selectedTeam}
        workers={workers}
        searchQuery={searchQuery}
        onOpenWorker={handleOpenWorker}
        onOpenTeamSettings={handleOpenTeamSettings}
        onOpenMillforge={setMillforgeTeam}
        onBack={narrowBack}
        userLevel={userLevel}
        className="h-full"
      />
    ) : (
      <Pane label="团队拓扑">
        <StaleSelectionState
          text="所选团队已不在最新数据中"
          buttonLabel="回列表"
          onBack={clearSelection}
        />
      </Pane>
    );
  } else if (selection?.kind === 'worker' && selectedWorker) {
    if (standalone.some((item) => item.name === selectedWorker.name)) {
      topology = (
        <Pane label="团队拓扑">
          <StandaloneWorkerContextCard name={selectedWorker.name} onBack={clearSelection} />
        </Pane>
      );
    } else {
      const homeTeam =
        (teams ?? []).find(
          (team) => team.name === selectedWorker.team || team.teamName === selectedWorker.team,
        ) ?? null;
      topology = homeTeam ? (
        <InteractiveTeamTopology
          team={homeTeam}
          workers={workers}
          searchQuery={searchQuery}
          highlightWorkerName={selectedWorker.name}
          onOpenWorker={handleOpenWorker}
          onOpenTeamSettings={handleOpenTeamSettings}
          onOpenMillforge={setMillforgeTeam}
          onBack={narrowBack}
          userLevel={userLevel}
          className="h-full"
        />
      ) : (
        <Pane label="团队拓扑">
          <StaleSelectionState
            text="所选 Worker 已不在最新数据中"
            buttonLabel="回列表"
            onBack={clearSelection}
          />
        </Pane>
      );
    }
  } else if (selection?.kind === 'worker' && !selectedWorker) {
    topology = (
      <Pane label="团队拓扑">
        <StaleSelectionState
          text="所选 Worker 已不在最新数据中"
          buttonLabel="回列表"
          onBack={clearSelection}
        />
      </Pane>
    );
  } else {
    topology = (
      <Pane label="团队拓扑">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
          <p className="text-sm font-semibold">选择团队</p>
          <p className="text-xs text-muted-foreground">点列表中的团队查看其拓扑</p>
        </div>
      </Pane>
    );
  }

  const listPane = (
    <Pane label="团队列表">
      <PaneHeader
        title="团队与 Agent"
        meta={hasSearch ? `${teamRows.length} / ${teams?.length ?? 0}` : `${teams?.length ?? 0}`}
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-1.5 custom-scrollbar">
        {isLoading ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">加载中…</p>
        ) : (
          <>
            {managers && managers.length > 0 && (
              <div className="space-y-1 p-1">
                <p className="px-1 text-xs font-semibold text-muted-foreground">Managers</p>
                {managers.map((manager) => (
                  <ManagerRow
                    key={manager.name}
                    manager={manager}
                    selected={selection?.kind === 'manager' && selection.name === manager.name}
                    onSelect={handleSelectManager}
                  />
                ))}
              </div>
            )}
            {teamRows.length === 0 ? (
              <div className="space-y-2 px-2 py-6 text-center">
                <p className="text-xs text-muted-foreground">
                  {hasSearch ? '没有匹配的团队 / 成员' : '暂无团队'}
                </p>
                {!hasSearch && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 text-xs sm:min-h-9"
                    onClick={() => setCreateTeamOpen(true)}
                  >
                    创建团队
                  </Button>
                )}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {teamRows.map((row) => (
                  <TeamListRow
                    key={row.team.name}
                    row={row}
                    workers={workers}
                    selected={selection?.kind === 'team' && selection.name === row.team.name}
                    onSelect={handleSelectTeam}
                  />
                ))}
              </ul>
            )}
            {standalone.length > 0 && (
              <StandaloneWorkersRow
                workers={standalone}
                selectedName={selection?.kind === 'worker' ? selection.name : null}
                expanded={standaloneExpanded}
                onToggle={() => setStandaloneExpanded((value) => !value)}
                onSelect={handleOpenWorker}
              />
            )}
          </>
        )}
      </div>
    </Pane>
  );

  const mainPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-0 flex-1">{topology}</div>
    </div>
  );

  return (
    <div className="space-y-3" data-testid="team-agents-section" data-layout={layout}>
      <SectionHeader
        title="团队与 Agent"
        description="团队 / Manager / Worker 统一管理：拓扑、详情与团队设置"
        isLive={isConnected}
        onRefresh={refresh}
        isRefreshing={isRefetching}
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 text-xs sm:min-h-9"
              onClick={() => setCreateWorkerOpen(true)}
            >
              <Bot className="size-3.5" aria-hidden="true" />
              创建 Agent
            </Button>
            <Button
              size="sm"
              className="min-h-11 text-xs sm:min-h-9"
              onClick={() => setCreateTeamOpen(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              创建团队
            </Button>
          </div>
        }
      />

      <div
        ref={shellRef}
        data-testid="team-agents-shell"
        className={`relative grid h-[calc(100dvh-14rem)] max-h-[1200px] min-h-[420px] w-full min-w-0 gap-3 overflow-x-hidden overflow-y-hidden ${gridClass}`}
      >
        {showList && listPane}
        {showMain && mainPane}
        {(layout === 'triple' || layout === 'triple-compact') && (
          <Pane label="实体详情">
            <EntityInspector
              entity={inspectorEntity}
              userLevel={userLevel}
              onOpenSection={handleOpenSection}
              onChanged={refresh}
              onDeleted={handleDeleted}
            />
          </Pane>
        )}
        {/* R3：dual 右栏 Inspector = 真 Sheet（遮罩 / 滑入 / 焦点圈 / Esc
            与遮罩点击关闭）；关闭只隐藏抽屉、保留选中，再点同一行重开。 */}
        {layout === 'dual' && (
          <Sheet modal={false} open={drawerOpen && inspectorEntity !== null} onOpenChange={(open) => setDrawerOpen(open)}>
            <SheetContent
              side="right"
              data-testid="inspector-drawer"
              className="w-[min(420px,92vw)] gap-0 p-0 sm:max-w-none"
            >
              <SheetTitle className="sr-only">实体详情</SheetTitle>
              <SheetDescription className="sr-only">当前选中实体（团队 / Agent / Manager）的详情分区</SheetDescription>
              {inspectorEntity && (
                <EntityInspector
                  entity={inspectorEntity}
                  userLevel={userLevel}
                  onOpenSection={handleOpenSection}
                  onChanged={refresh}
                  onDeleted={handleDeleted}
                  onClose={() => setDrawerOpen(false)}
                />
              )}
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* R3（非模态抽屉）：自绘遮罩放在壳外，点它只关抽屉、保留选中。
          data-slot=sheet-overlay 与 Radix Sheet 的遮罩标记对齐（测试/样式共用）。 */}
      {layout === 'dual' && drawerOpen && inspectorEntity !== null && (
        <div
          data-slot="sheet-overlay"
          data-testid="inspector-backdrop"
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/20"
          onPointerDown={() => setDrawerOpen(false)}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <TeamCreateDialog
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
        value={newTeam}
        onChange={setNewTeam}
        isPending={createTeam.isPending}
        onSubmit={handleCreateTeam}
        workers={workers ?? []}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        onWorkerCreated={refresh}
      />

      <WorkerCreateDialog
        open={createWorkerOpen}
        onOpenChange={setCreateWorkerOpen}
        value={newWorker}
        onChange={setNewWorker}
        isPending={createWorker.isPending}
        onSubmit={handleCreateWorker}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
      />

      {/* R2 详情大弹窗：承载当前 main 版面板，壳见 detail-dialog-shell.tsx。
          A3：initialTab = 当前分区（Inspector 分区按钮 / 齿轮 / 深链 ?panel=）。 */}
      <TeamDetailDialog
        open={detailOpen && selection?.kind === 'team'}
        onOpenChange={handleDetailOpenChange}
        team={selectedTeam}
        allTeams={teams}
        workers={workers ?? []}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={refresh}
        onDeleted={handleDeleted}
        initialTab={dialogPanel ?? undefined}
        chrome={layout === 'single' ? 'full' : 'section'}
      />
      <WorkerDetailDialog
        open={detailOpen && selection?.kind === 'worker'}
        onOpenChange={handleDetailOpenChange}
        worker={selectedWorker}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={refresh}
        onDeleted={handleDeleted}
        initialTab={dialogPanel ?? undefined}
        chrome={layout === 'single' ? 'full' : 'section'}
      />
      <ManagerDetailDialog
        open={detailOpen && selection?.kind === 'manager'}
        onOpenChange={handleDetailOpenChange}
        manager={selectedManager}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={refresh}
        initialTab={dialogPanel ?? undefined}
        chrome={layout === 'single' ? 'full' : 'section'}
      />

      {millforgeTeam ? (
        <MillforgeDialog
          open
          team={millforgeTeam}
          workers={workers ?? []}
          canInstall={userLevel >= 3}
          modelAliases={modelOptions.map((option) => option.alias)}
          onOpenChange={(open) => !open && setMillforgeTeam(null)}
          onInjected={refresh}
        />
      ) : null}
    </div>
  );
}

/** R4 兼容导出：旧 'workers' section id（深链）落到同一工作台。 */
export function AgentsSection() {
  return <TeamAgentsSection />;
}

/** R4 兼容导出：旧 'teams' / 'team-agents' section id（深链）落到同一工作台。 */
export function TeamsSection() {
  return <TeamAgentsSection />;
}
