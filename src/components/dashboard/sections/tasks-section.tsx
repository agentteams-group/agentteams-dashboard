'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ListTodo,
  Search,
  CircleCheck,
  CircleX,
  Loader2,
  Clock,
  ChevronUp,
  MessageSquare,
  Crown,
  User,
  Users,
  Eye,
  FolderTree,
  GitBranch,
  Layers,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  RotateCcw,
  Database,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiUrl, requestJson } from '@/lib/api-base';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { SectionEmptyState } from '@/components/dashboard/section-empty-state';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SectionHeader } from '@/components/dashboard/section-header';
import { currentHashParams } from '@/lib/nav-hash';
import { useMatrixStore } from '@/lib/matrix-store';
import { useActiveSection } from '@/components/dashboard/use-active-section';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import {
  useMergedTaskBoard,
  useLogTaskBoardScan,
  type BoardTask,
  type BoardProject,
  type TaskStatus,
  type ProjectStatus,
  type PlanItem,
} from '@/hooks/use-task-board';
import { useApiTaskBoard } from '@/hooks/use-projects';
import { useProjectRoomTimestamps } from '@/hooks/use-project-room-ts';
// Project governance panel (pause / resume / replan / cancel / artifacts /
// timeline) — defined in the (now-merged) projects section; only the panel
// crosses the module boundary.
import { WorkflowDetail } from './projects/workflow-detail';
import { MetaEditorEntry } from './projects/meta-editor';
import { useTaskStore } from '@/lib/task-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { openChatRoom } from '@/lib/open-chat-room';
import { buildProjectDag } from '@/lib/project-dag';
import { usePersistentState } from '@/lib/use-persistent-state';
import { isStaleProjectSelection } from './task-selectors';
import { ProjectDagSvg, type DagNodeColor } from '@/components/dashboard/project-dag-svg';

// ----- Status config -----

import { PROJECT_STATUS_COLOR, OUTCOME_COLOR } from '@/lib/status-colors';
import { INTERACTIVE_CARD_CLASS, handleActivate } from '@/lib/interaction-states';

const TASK_STATUS_COLUMNS: Array<{
  key: TaskStatus;
  label: string;
  description: string;
  color: string; // tailwind text/bg
  icon: typeof CircleCheck;
}> = [
  {
    key: 'pending',
    label: '待办',
    description: 'Manager 拆分但尚未派发',
    color: 'text-muted-foreground bg-muted border-border',
    icon: Clock,
  },
  {
    key: 'assigned',
    label: '已派发',
    description: '已发给 Worker,等待首次心跳',
    color: 'text-foreground bg-muted border-border',
    icon: ChevronUp,
  },
  {
    key: 'in_progress',
    label: '进行中',
    description: 'Worker 正在执行',
    color: 'text-status-running bg-status-running/5 border-status-running/15',
    icon: Loader2,
  },
  {
    key: 'revision',
    label: '需修订',
    description: 'Manager 验收未通过,打回重做',
    color: 'text-status-waiting bg-status-waiting/5 border-status-waiting/15',
    icon: RotateCcw,
  },
  {
    key: 'completed',
    label: '已完成',
    description: 'Worker 报完成,Manager 已确认',
    color: 'text-status-done bg-status-done/5 border-status-done/15',
    icon: CircleCheck,
  },
  {
    key: 'failed',
    label: '失败',
    description: '执行失败,需要人工介入',
    color: 'text-status-failed bg-status-failed/5 border-status-failed/15',
    icon: CircleX,
  },
  {
    key: 'blocked',
    label: '阻塞',
    description: '等待依赖项完成或外部解锁',
    color: 'text-status-waiting bg-status-waiting/5 border-status-waiting/15',
    icon: AlertTriangle,
  },
  {
    key: 'unknown',
    label: '未知',
    description: '状态未知',
    color: 'text-muted-foreground bg-muted border-border',
    icon: Eye,
  },
];

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: '规划中',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  unknown: '未知',
};

const OUTCOME_LABEL: Record<NonNullable<BoardTask['outcome']>, string> = {
  SUCCESS: '成功',
  SUCCESS_WITH_NOTES: '成功 (附注)',
  REVISION_NEEDED: '需修订',
  BLOCKED: '阻塞',
};

const MARKER_LABEL: Record<string, string> = {
  ' ': '待办',
  '~': '进行中',
  x: '完成',
  '!': '阻塞',
  '→': '需修订',
};

// ----- Helpers -----

function shortId(id: string, head = 14): string {
  if (id.length <= head) return id;
  return `${id.slice(0, head)}…`;
}

function displayTime(epochMs: number): string {
  if (!epochMs) return '—';
  const d = new Date(epochMs);
  const now = Date.now();
  const diff = now - epochMs;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function findManagerByMatrixId(
  managers: { name: string; matrixUserID?: string }[],
  sender: string,
): string | undefined {
  if (!sender) return undefined;
  return managers.find((m) => m.matrixUserID === sender)?.name;
}

function findWorkerByName(
  workers: { name: string; matrixUserID?: string; team?: string }[],
  name: string,
): { name: string; matrixUserID: string; team: string } | undefined {
  if (!name) return undefined;
  const exact = workers.find((w) => w.name === name);
  if (exact) return { name: exact.name, matrixUserID: exact.matrixUserID || '', team: exact.team || '' };
  const byMatrix = workers.find((w) => w.matrixUserID === name);
  if (byMatrix) return { name: byMatrix.name, matrixUserID: byMatrix.matrixUserID || '', team: byMatrix.team || '' };
  return undefined;
}

// ----- Sub-components -----

function StatusBadge({ status }: { status: TaskStatus }) {
  const cfg = TASK_STATUS_COLUMNS.find((c) => c.key === status);
  if (!cfg) {
    return <Badge variant="outline" className="text-xs">未知</Badge>;
  }
  const Icon = cfg.icon;
  return (
    <Badge className={`text-xs gap-1 border ${cfg.color}`}>
      <Icon className={`h-2.5 w-2.5 ${status === 'in_progress' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </Badge>
  );
}

function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={`text-xs border ${PROJECT_STATUS_COLOR[status]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </Badge>
  );
}

function OutcomeBadge({ outcome }: { outcome: BoardTask['outcome'] }) {
  if (!outcome) return null;
  return (
    <Badge className={`text-xs border ${OUTCOME_COLOR[outcome]}`}>
      {OUTCOME_LABEL[outcome]}
    </Badge>
  );
}

function PlanItemRow({ item }: { item: PlanItem }) {
  const markerChar = item.marker.replace(/[[\]]/g, '');
  const color =
    item.done
      ? 'text-emerald-500 line-through opacity-60'
      : item.inProgress
        ? 'text-violet-500'
        : item.blocked
          ? 'text-red-500'
          : 'text-muted-foreground';
  return (
    <div className="flex items-start gap-2 text-xs">
      <span
        className={`shrink-0 font-mono w-4 text-center ${color}`}
        title={MARKER_LABEL[markerChar] ?? markerChar}
      >
        {item.marker}
      </span>
      <div className="flex-1 min-w-0">
        <span className={item.done ? 'line-through opacity-70' : ''}>{item.text}</span>
        {item.owner && (
          <span className="ml-2 text-muted-foreground">@ {item.owner}</span>
        )}
        {item.taskId && (
          <span className="ml-2 text-muted-foreground/70 font-mono">
            ({shortId(item.taskId, 18)})
          </span>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  managerName,
  workerTeam,
  highlightProjectId,
  selected,
  showStatus = true,
  onClick,
}: {
  task: BoardTask;
  managerName?: string;
  workerTeam?: string;
  highlightProjectId?: string;
  selected?: boolean;
  showStatus?: boolean;
  onClick?: () => void;
}) {
  const expanded = selected ?? (highlightProjectId === task.projectId);
  return (
    <Card
      {...(onClick
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-pressed': expanded,
            onClick,
            onKeyDown: handleActivate(onClick),
          }
        : {})}
      className={`gap-0 rounded-lg border bg-card py-0 shadow-none ${onClick ? INTERACTIVE_CARD_CLASS : 'transition-colors hover:border-foreground/20'} ${expanded ? 'border-primary/35' : 'border-border'}`}
    >
      <CardContent className="space-y-3 p-4">
        {(showStatus || task.outcome || task.dependsOn.length > 0) && <div className="flex items-start gap-2">
          {showStatus && <StatusBadge status={task.status} />}
          {task.outcome && <OutcomeBadge outcome={task.outcome} />}
          {task.dependsOn.length > 0 && (
            <Badge
              variant="outline"
              className="text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
              title={`依赖 ${task.dependsOn.length} 个前置任务`}
            >
              <Layers className="h-2.5 w-2.5" />
              ×{task.dependsOn.length}
            </Badge>
          )}
        </div>}
        <div>
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium leading-6">{task.title}</p>
            {!showStatus && task.status === 'in_progress' && <Loader2 aria-label="任务正在执行" className="mt-1 size-3.5 shrink-0 text-status-running motion-safe:animate-spin" />}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            {shortId(task.runId, 22)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {task.assignedTo && (
            <span className="flex items-center gap-1">
              {managerName ? (
                <>
                  <Crown className="h-3 w-3" />
                  <span>{managerName}</span>
                </>
              ) : (
                <>
                  <User className="h-3 w-3" />
                  {task.assignedTo}
                </>
              )}
              {workerTeam && <span className="text-muted-foreground/60">· {workerTeam}</span>}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {displayTime(task.createdAt)}
          </span>
        </div>
        {task.roomId && (
          <button
            type="button"
            onClick={(e) => {
              // 会话维度（F4.1）：来源空间可点直达，且不触发卡片自身的点击
              e.stopPropagation();
              openChatRoom(task.roomId);
            }}
            title="打开来源空间会话"
            className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-2.5 w-2.5" />
            <span className="font-mono truncate">{shortId(task.roomId, 24)}</span>
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectCard({
  project,
  taskCount,
  onSelect,
  selected,
  onMetaSaved,
}: {
  project: BoardProject;
  taskCount: number;
  onSelect: (_id: string) => void;
  selected: boolean;
  onMetaSaved?: () => void;
}) {
  const allItems = project.phases.flatMap((p) => p.items);
  const done = allItems.filter((i) => i.done).length;
  const total = allItems.length;
  const inProgress = allItems.filter((i) => i.inProgress).length;
  const blocked = allItems.filter((i) => i.blocked).length;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(project.runId)}
      onKeyDown={handleActivate(() => onSelect(project.runId))}
      className={`glass-card ${INTERACTIVE_CARD_CLASS} ${
        selected ? 'border-violet-500/50 ring-1 ring-violet-500/30' : ''
      }`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2 flex-wrap">
          <ProjectStatusBadge status={project.status} />
          <Badge variant="outline" className="text-xs gap-1">
            <Layers className="h-2.5 w-2.5" />
            {project.phases.length} 阶段
          </Badge>
          <Badge variant="outline" className="text-xs gap-1">
            <ListTodo className="h-2.5 w-2.5" />
            {taskCount} 任务
          </Badge>
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{project.name}</p>
            {/* 项目 meta 编辑入口（仅 Controller API 项目有 meta 端点；
                405/404 → 入口自隐藏） */}
            {project.source === 'api' && (
              <MetaEditorEntry
                kind="project"
                id={project.runId}
                title={project.name}
                teamId={project.teamId}
                onSaved={onMetaSaved}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {project.runId}
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>plan 进度</span>
            <span>
              {done}/{total} · {progressPct}%
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {project.leader && (
            <span className="flex items-center gap-1">
              <Crown className="h-3 w-3" />
              {project.leader}
            </span>
          )}
          {project.workers.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {project.workers.length} Worker
            </span>
          )}
          {inProgress > 0 && (
            <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {inProgress} 进行中
            </span>
          )}
          {blocked > 0 && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              {blocked} 阻塞
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectPlanPreview({ project }: { project: BoardProject }) {
  const allItems = project.phases.flatMap((p) => p.items);
  if (allItems.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        该项目暂无 plan.md 计划阶段
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {project.phases.map((phase, i) => (
        <div key={`${project.runId}-phase-${i}`}>
          <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            {phase.heading}
            <span className="text-xs text-muted-foreground/70 font-normal">
              {phase.items.filter((i) => i.done).length}/{phase.items.length}
            </span>
          </p>
          <div className="space-y-1">
            {phase.items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">无子任务</p>
            ) : (
              phase.items.map((item, j) => (
                <PlanItemRow key={`${i}-${j}-${item.taskId ?? item.text}`} item={item} />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ----- Project DAG view -----

const DAG_NODE_FILL: Record<string, DagNodeColor> = {
  pending: { fill: 'rgba(148,163,184,0.12)', stroke: '#94a3b8', text: '#94a3b8' },
  assigned: { fill: 'rgba(148,163,184,0.18)', stroke: '#94a3b8', text: '#cbd5e1' },
  in_progress: { fill: 'rgba(139,92,246,0.16)', stroke: '#8b5cf6', text: '#a78bfa' },
  revision: { fill: 'rgba(245,158,11,0.14)', stroke: '#f59e0b', text: '#fbbf24' },
  completed: { fill: 'rgba(16,185,129,0.14)', stroke: '#10b981', text: '#34d399' },
  failed: { fill: 'rgba(239,68,68,0.14)', stroke: '#ef4444', text: '#f87171' },
  blocked: { fill: 'rgba(249,115,22,0.14)', stroke: '#f97316', text: '#fdba74' },
  unknown: { fill: 'rgba(148,163,184,0.08)', stroke: '#64748b', text: '#94a3b8' },
};

function ProjectDagView({ project, tasks }: { project: BoardProject; tasks: BoardTask[] }) {
  const dag = useMemo(
    () => buildProjectDag(tasks, project.runId),
    [tasks, project.runId],
  );

  if (dag.nodes.length === 0) return null;
  if (dag.edges.length === 0 && dag.nodes.length <= 1) {
    return (
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <GitBranch className="h-3 w-3" />
          依赖图
        </p>
        <p className="text-xs text-muted-foreground italic">
          该项目任务之间暂无依赖关系
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
        <GitBranch className="h-3 w-3" />
        依赖图
        <span className="text-xs text-muted-foreground/70 font-normal">
          {dag.nodes.length} 任务 · {dag.edges.length} 依赖
          {dag.externalDeps.length > 0 && ` · ${dag.externalDeps.length} 外部依赖`}
        </span>
      </p>
      <div className="rounded-lg border bg-background/40 overflow-x-auto p-2">
        <ProjectDagSvg dag={dag} nodeColors={DAG_NODE_FILL} title={`${project.name} 任务依赖图`} />
      </div>
    </div>
  );
}

// ----- Main section -----

type ViewMode = 'kanban' | 'projects';

const TASKS_VIEW_KEY = 'agentteams:tasks-view';
const TASKS_PROJECT_KEY = 'agentteams:tasks-selected-project';

const isTasksViewMode = (raw: unknown): raw is ViewMode =>
  raw === 'kanban' || raw === 'projects';

// null = no explicit selection (the board auto-shows the first project);
// only non-empty strings are restored from storage.
const isProjectIdOrNone = (raw: unknown): raw is string | null =>
  raw === null || (typeof raw === 'string' && raw.length > 0);

export function TasksSection() {
  const { setActiveSection } = useActiveSection();
  const matrixLoggedIn = useMatrixStore((s) => s.isLoggedIn);
  const clearTasks = useTaskStore((s) => s.clearTasks);

  // D5 双轨：主源 = Controller projects/workflow API（standardized），
  // 降级 = MinIO 直读看板（API 未部署/Controller 故障时 fallback）。
  // Matrix 实时事件（useTaskStore）作为叠加层两轨共享。
  const apiBoard = useApiTaskBoard();
  const minioBoard = useMergedTaskBoard({
    refetchInterval: 8000,
    enabled: apiBoard.degraded,
  });
  const primary = apiBoard.degraded ? minioBoard : apiBoard;
  useLogTaskBoardScan(
    minioBoard.matchedPrefixes,
    minioBoard.scannedKeys,
    minioBoard.bucket,
    minioBoard.error,
  );

  // Live Matrix workflow events fill in runIds the board doesn't know about
  // and refresh statuses. Subscribed reactively (not getState snapshot) so
  // live updates re-merge into the board.
  const live = useTaskStore(useShallow((s) => s.tasks));
  const board = useMemo(() => {
    const byId = new Map<string, (typeof primary.tasks)[number]>();
    for (const t of primary.tasks) byId.set(t.runId, t);
    for (const [, e] of Object.entries(live)) {
      const existing = byId.get(e.runId);
      const liveTask = {
        runId: e.runId,
        title: e.title,
        status: e.status as TaskStatus,
        assignedTo: e.senderMatrixUserId,
        roomId: e.roomId,
        projectId: existing?.projectId,
        dependsOn: existing?.dependsOn ?? [],
        createdAt: e.createdAt,
        completedAt: existing?.completedAt,
        outcome: existing?.outcome ?? null,
        spec: existing?.spec,
        source: 'matrix-live',
      };
      byId.set(
        e.runId,
        existing ? { ...existing, status: liveTask.status } : liveTask,
      );
    }
    return {
      ...primary,
      tasks: Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt),
    };
  }, [primary, live]);

  const { data: managers } = useManagers();
  const { data: workers } = useWorkers();

  // View + project selection survive section switches and refreshes
  // (post-mount restore; a deep link consumed during first render wins).
  const [view, setView] = usePersistentState<ViewMode>(
    TASKS_VIEW_KEY,
    'kanban',
    isTasksViewMode,
  );
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = board.tasks.find(task => task.runId === selectedTaskId) ?? null;
  const [selectedProjectId, setSelectedProjectId] = usePersistentState<
    string | null
  >(TASKS_PROJECT_KEY, null, isProjectIdOrNone);
  const [reloadKey, setReloadKey] = useState(0);

  // 项目视图左栏排序（9/16 装验反馈第 2/3/4 轮：左栏项目要能按时间排序）。
  // 9/16 真机 E2E 定位：独立 ProjectsSection 已并入任务看板（nav-items 注释
  // 「项目视图已并入任务看板」），修复必须落在本视图——与插件 WorkflowBoard
  // 同款语义（时间新→旧 默认）。
  const [projSort, setProjSort] = useState<'time_desc' | 'time_asc' | 'name'>(
    'time_desc',
  );
  // 9/17 装验第 7 轮：controller projectSummary 无时间戳（源码实锤：struct
  // 仅 6 字段）且 proj-<uuid> 无内嵌日期 → 时间排序对 API 项目无数据可用，
  // 静默退化为名称序。兜底第三源 = 项目房间最后一条消息 ts（与插件
  // projectActivityTs 同款语义，60s 缓存，limit 1）；名称排序时零请求。
  const roomTs = useProjectRoomTimestamps(board.projects, projSort !== 'name');
  const sortedProjects = useMemo(() => {
    const list = [...board.projects];
    list.sort((a, b) => {
      if (projSort === 'name') {
        return a.name.localeCompare(b.name, 'en');
      }
      const ta = (a.completedAt ?? a.createdAt) || roomTs.get(a.runId) || 0;
      const tb = (b.completedAt ?? b.createdAt) || roomTs.get(b.runId) || 0;
      // 无时间戳的条目垫底（与 projects-section/artifacts-section 同款语义）
      if (!ta && !tb) return a.name.localeCompare(b.name, 'en');
      if (!ta) return 1;
      if (!tb) return -1;
      return projSort === 'time_desc' ? tb - ta : ta - tb;
    });
    return list;
  }, [board.projects, projSort, roomTs]);

  // Atomically consume the pending project deep-link (HITL inbox card). The
  // task board now owns the project view, so a deep link targets a project in
  // this section rather than the removed standalone projects section.
  //
  // Implemented as a mount-only effect (not "consumed during render") so the
  // side-effecting setView / setSelectedProjectId calls happen OUTSIDE of
  // React's render phase. Doing this in the render body of an AnimatePresence
  // child was fine in isolation but reacted to "Cannot update a component
  // while rendering a different component" when the dashboard shell (the
  // section guard effect at agent-teams-dashboard line 151-178) re-rendered
  // concurrently, and tripped the task section into an empty render that
  // looked like "first click on 任务看板 doesn't switch". The mount-only
  // effect solves both: store mutation happens post-commit, and any pending
  // key only fires on the first mount of TasksSection (mount-only deps).
  useEffect(() => {
    const pendingProjectKey = useHitlInboxStore.getState().takePendingProjectKey();
    if (pendingProjectKey?.id) {
      setView('projects');
      setSelectedProjectId(pendingProjectKey.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 深链消费（方案 v3 C-2）：命令面板命中任务/项目后写的是
  // `#workbench/tasks?project=<runId>`；导航只走 hash（C-1 定的单一路径），
  // 所以参数得在本视图读回选中态。除了挂载，还听 hashchange：否则从面板
  // 第两次点不同项目只会改地址、不切项目。只在当前 hash 就是看板路径时
  // 应用，避开别的路径上残留的查询参数。
  useEffect(() => {
    const applyProjectParam = () => {
      const path = window.location.hash.replace(/^#/, '').split('?')[0];
      if (path !== 'workbench/tasks') return;
      const projectId = currentHashParams()?.get('project');
      if (!projectId) return;
      setView('projects');
      setSelectedProjectId(projectId);
    };
    applyProjectParam();
    window.addEventListener('hashchange', applyProjectParam);
    return () => window.removeEventListener('hashchange', applyProjectParam);
  }, [setView, setSelectedProjectId]);

  const handleReload = useCallback(() => {
    clearTasks();
    setReloadKey((k) => k + 1);
    board.refetch();
  }, [clearTasks, board]);

  // Auto-select the first project: derive the effective selection instead of
  // syncing state in an effect, so the first project shows until the user
  // picks one explicitly.
  const effectiveProjectId = selectedProjectId ?? board.projects[0]?.runId ?? null;

  // 恢复的选中项目若已不在看板（项目被删/改名），清除持久化值——否则每次
  // 刷新都会闪现第一个项目再兜底，脏 id 还会被反复重新持久化。等 board 有
  // 数据再判定（加载中 projects 为空，不误清合法存储值；见
  // task-selectors.isStaleProjectSelection）。
  useEffect(() => {
    if (isStaleProjectSelection(selectedProjectId, board.projects.map((p) => p.runId))) {
      setSelectedProjectId(null);
    }
  }, [selectedProjectId, board.projects, setSelectedProjectId]);

  // ---- Filters ----
  const filteredTasks = useMemo(() => {
    if (!search) return board.tasks;
    const q = search.toLowerCase();
    return board.tasks.filter((t) => {
      if (t.title.toLowerCase().includes(q)) return true;
      if (t.runId.toLowerCase().includes(q)) return true;
      if (t.assignedTo.toLowerCase().includes(q)) return true;
      if (t.projectId?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [board.tasks, search]);

  const tasksForProject = useCallback(
    (projectId: string) =>
      filteredTasks.filter((t) => t.projectId === projectId),
    [filteredTasks],
  );

  // Group by status for the kanban view
  const tasksByStatus = useMemo(() => {
    const map = new Map<TaskStatus, BoardTask[]>(
      TASK_STATUS_COLUMNS.map((c) => [c.key, [] as BoardTask[]]),
    );
    for (const t of filteredTasks) {
      const list = map.get(t.status) ?? map.get('unknown')!;
      list.push(t);
    }
    return map;
  }, [filteredTasks]);

  const counts = useMemo(() => {
    let running = 0;
    let completed = 0;
    let failed = 0;
    let blocked = 0;
    let revision = 0;
    for (const t of board.tasks) {
      if (t.status === 'in_progress' || t.status === 'assigned') running++;
      else if (t.status === 'completed') completed++;
      else if (t.status === 'revision') revision++;
      else if (t.status === 'failed') failed++;
      else if (t.status === 'blocked') blocked++;
    }
    return { running, completed, failed, blocked, revision, total: board.tasks.length };
  }, [board.tasks]);

  const selectedProject = board.projects.find((p) => p.runId === effectiveProjectId);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="任务看板"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {(['kanban', 'projects'] as const).map((v) => (
                <Button
                  key={v}
                  variant={view === v ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setView(v)}
                >
                  {v === 'kanban' ? (
                    <>
                      <Layers className="h-3.5 w-3.5 mr-1" />
                      看板
                    </>
                  ) : (
                    <>
                      <FolderTree className="h-3.5 w-3.5 mr-1" />
                      项目
                    </>
                  )}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReload}
              disabled={board.isLoading}
              title={
              apiBoard.degraded
                ? '清空 Matrix 缓存并重新拉取 MinIO 任务'
                : '清空 Matrix 实时叠加并重新拉取 Controller 项目 API'
            }
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${board.isLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        }
      />

      {/* Compact task summary */}
      <div aria-label="任务状态汇总" className="flex items-center gap-5 overflow-x-auto rounded-lg border border-border px-4 py-2 text-sm">
        {[
          {
            label: '进行中',
            count: counts.running,
            color: 'text-foreground',
          },
          {
            label: '已完成',
            count: counts.completed,
            color: 'text-foreground',
          },
          {
            label: '需修订',
            count: counts.revision,
            color: 'text-foreground',
          },
          {
            label: '阻塞',
            count: counts.blocked,
            color: 'text-foreground',
          },
          {
            label: '失败',
            count: counts.failed,
            color: 'text-foreground',
          },
        ].map((s) => (
          <div key={s.label} className="flex shrink-0 items-center gap-2">
            <span className="text-muted-foreground">{s.label}</span>
            <span className={`font-mono font-semibold ${s.color}`}>{s.count}</span>
          </div>
        ))}
      </div>

      {/* Diagnostic banner (MinIO fallback only — the API primary source
          reports its own degraded state via the projects section). */}
      {apiBoard.degraded && minioBoard.bucket && minioBoard.scannedKeys.length === 0 && !minioBoard.isLoading && (
        <Card className="glass-card border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-start gap-2 text-xs">
            <Database className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                MinIO 暂未发现任务数据（Controller API 已降级）
              </p>
              <p className="text-muted-foreground">
                Bucket <code className="font-mono">{minioBoard.bucket}</code> · 扫描路径{' '}
                <code className="font-mono">shared/tasks/, shared/projects/, agents/*/task-history.json</code>
                {minioBoard.matchedPrefixes.length > 0 && (
                  <>
                    {' '}· 匹配:{' '}
                    <code className="font-mono">{minioBoard.matchedPrefixes.join(', ')}</code>
                  </>
                )}
              </p>
              <p className="text-muted-foreground/70">
                数据完全来自 Matrix 房间实时消息:Manager 在 Worker/Project 房间内的
                <code className="font-mono mx-1">agentteams.workflow</code>
                结构体会在实时列出现;MinIO 同步后将在持久列出现。
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索任务标题 / Run ID / 负责人 / 项目 ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* One quiet empty state instead of eight oversized empty columns. */}
      {view === 'kanban' && filteredTasks.length === 0 && <div className="rounded-xl border border-border bg-muted/10">
        <SectionEmptyState title={board.isLoading ? '正在加载任务…' : (apiBoard.degraded && minioBoard.error) ? '暂时无法读取任务' : search ? '未找到匹配任务' : '暂无任务'} description={(apiBoard.degraded && minioBoard.error) ? '请刷新重试。' : search ? '试试其他关键词。' : '与助手创建任务后，可以在这里跟进执行进度。'} />
      </div>}

      {/* Neutral columns; state color is limited to the header indicator. */}
      {view === 'kanban' && filteredTasks.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TASK_STATUS_COLUMNS.map((col) => {
            const list = tasksByStatus.get(col.key) ?? [];
            return (
              <div
                key={col.key}
                className="flex h-[360px] flex-col gap-3 overflow-hidden rounded-xl border border-border bg-muted/10 p-3"
              >
                <div className={`-mx-3 -mt-3 flex items-center gap-2 border-b px-3 py-3 ${col.color}`}>
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full bg-current ${col.color.split(' ')[0]} ${col.key === 'in_progress' && list.length > 0 ? 'motion-safe:animate-pulse' : ''}`} />
                  <p className="text-xs font-semibold">{col.label}</p>
                  <span className="ml-auto rounded-md bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain custom-scrollbar">
                  <AnimatePresence initial={false}>
                    {list.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground/70">
                        暂无任务
                      </p>
                    ) : (
                      list.map((t) => {
                        const mgr = findManagerByMatrixId(managers ?? [], t.assignedTo);
                        const wk = findWorkerByName(workers ?? [], t.assignedTo);
                        return (
                          <motion.div
                            key={t.runId}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                          >
                            <TaskCard
                              task={t}
                              managerName={mgr}
                              workerTeam={wk?.team}
                              highlightProjectId={effectiveProjectId ?? undefined}
                              selected={selectedTaskId === t.runId}
                              showStatus={false}
                              onClick={() => setSelectedTaskId(t.runId)}
                            />
                          </motion.div>
                        );
                      })
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskDetailSheet task={selectedTask} teamId={board.projects.find(project => project.runId === selectedTask?.projectId)?.teamId} onClose={() => setSelectedTaskId(null)} onOpenProject={() => {
        if (selectedTask?.projectId) { setSelectedProjectId(selectedTask.projectId); setView('projects'); setSelectedTaskId(null); }
      }} />

      {/* View: Projects (cards + selected project plan)
          9/17 装验反馈 G4：row 容器固定撑满剩余屏高（round-4 同 220px
          顶部偏移常量）——双栏各自内部滚动，滚到底不再带着整页往下滚
          （overscroll-contain 双保险）。
          9/17 验收第六轮：补 lg:grid-rows-[minmax(0,1fr)]——只给容器固定
          高度时隐式行仍是 auto 轨道，子元素 h-full 百分比对 auto 轨道
          解析失败（退化为内容高度），右栏 scroller 因此没有约束高度=
          不可滚动（上一装验轮反馈「右边无法滚动」根因）。minmax(0,1fr)
          让唯一行=容器全高（定高），h-full 链才逐级成立。 */}
      {view === 'projects' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[calc(100vh-220px)] lg:grid-rows-[minmax(0,1fr)]">
          <div className="lg:col-span-1 space-y-3 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            {board.projects.length === 0 ? (
              <Card className="glass-card">
                <CardContent className="p-0">
                  <SectionEmptyState
                    icon={FolderTree}
                    title="暂无项目"
                    description="Manager 创建项目后会写入 shared/projects/{id}/meta.json"
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-card">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    选择项目（{board.projects.length}）
                  </p>
                  <Select
                    value={projSort}
                    onValueChange={(v) =>
                      setProjSort(v as 'time_desc' | 'time_asc' | 'name')
                    }
                  >
                    <SelectTrigger className="h-7 w-auto min-w-[108px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="time_desc">时间 新→旧</SelectItem>
                      <SelectItem value="time_asc">时间 旧→新</SelectItem>
                      <SelectItem value="name">名称</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* 左栏独立滚动（9/16 装验反馈：左栏列表要独立滚动条） */}
                <div className="max-h-[calc(100vh-220px)] min-h-[120px] space-y-2 overflow-y-auto p-3">
                  {sortedProjects.map((p) => (
                    <ProjectCard
                      key={p.runId}
                      project={p}
                      taskCount={tasksForProject(p.runId).length}
                      onSelect={setSelectedProjectId}
                      selected={p.runId === effectiveProjectId}
                      onMetaSaved={() => board.refetch()}
                    />
                  ))}
                </div>
              </Card>
            )}
          </div>
          <div className="lg:col-span-2 lg:h-full">
            {selectedProject ? (
              <Card className="glass-card lg:h-full lg:min-h-0">
                {/* G4（9/17 装验反馈）：row 已固定撑满屏高 → 右栏详情
                    直接 h-full 顶满行高（Card py-6 自带上下留白），
                    内部滚动 + overscroll-contain 止滚轮连锁。移动端
                    保持旧 max-h（无固定行高）。 */}
                <div className="max-h-[calc(100vh-260px)] lg:max-h-none lg:h-full overflow-y-auto overscroll-contain">
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold">{selectedProject.name}</h3>
                      <ProjectStatusBadge status={selectedProject.status} />
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {selectedProject.runId}
                    </p>
                    {selectedProject.roomId && (
                      <button
                        type="button"
                        onClick={() => openChatRoom(selectedProject.roomId)}
                        title="打开该项目的协作空间会话"
                        className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        <MessageSquare className="h-3 w-3" />
                        <span className="font-mono underline decoration-dotted underline-offset-2">
                          {selectedProject.roomId}
                        </span>
                      </button>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">执行计划</p>
                    <ProjectPlanPreview project={selectedProject} />
                  </div>
                  <ProjectDagView
                    project={selectedProject}
                    tasks={tasksForProject(selectedProject.runId)}
                  />
                  {selectedProject.source === 'api' ? (
                    <WorkflowDetail
                      projectId={selectedProject.runId}
                      teamId={selectedProject.teamId}
                    />
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        该项目的任务 ({tasksForProject(selectedProject.runId).length})
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {tasksForProject(selectedProject.runId).map((t) => (
                          <TaskCard key={t.runId} task={t} />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
                </div>
              </Card>
            ) : (
              <Card className="glass-card">
                <CardContent className="p-8 text-center">
                  <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">从左侧选择一个项目查看详情</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Not-logged-in fallback */}
      {!matrixLoggedIn && (
        <Card className="glass-card">
          <CardContent className="p-12 text-center">
            <ListTodo className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm font-medium">尚未登录 Matrix</p>
            <p className="text-xs text-muted-foreground mt-1">
              登录后可看到 Manager / Worker 实时工作汇报
            </p>
            <Button
              variant="default"
              size="sm"
              className="mt-4"
              onClick={() => setActiveSection('chat')}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              前往聊天登录
            </Button>
          </CardContent>
        </Card>
      )}

      <div data-reload-key={reloadKey} hidden />
    </div>
  );
}

interface TaskMetaDetail {
  status?: string;
  summary?: string;
  description?: string;
  spec_path?: string;
  result_summary?: string;
  result_path?: string;
  deliverables?: Array<string | { name?: string; path?: string; description?: string }>;
}

function TaskDetailSheet({ task, teamId, onClose, onOpenProject }: { task: BoardTask | null; teamId?: string; onClose: () => void; onOpenProject: () => void }) {
  const detail = useQuery({
    queryKey: ['task-detail', task?.runId, teamId],
    queryFn: () => requestJson<TaskMetaDetail>(apiUrl(`/api/agentteams/tasks/${encodeURIComponent(task!.runId)}/meta${teamId ? `?team=${encodeURIComponent(teamId)}` : ''}`)),
    enabled: !!task,
    retry: false,
    throwOnError: false,
  });
  return <Sheet open={!!task} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="sm:max-w-lg">
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle>{task?.title ?? '任务详情'}</SheetTitle>
        <SheetDescription>查看任务状态、执行说明与交付结果</SheetDescription>
      </SheetHeader>
      {task && <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 custom-scrollbar">
        <div className="flex items-center gap-2">{detail.data?.status === 'submitted' ? <Badge variant="outline" className="text-status-waiting">待验收</Badge> : <StatusBadge status={task.status} />}{task.outcome && <OutcomeBadge outcome={task.outcome} />}</div>
        <dl className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">负责人</dt><dd>{task.assignedTo || '未分配'}</dd>
          <dt className="text-muted-foreground">任务编号</dt><dd className="break-all font-mono text-xs">{task.runId}</dd>
          {task.projectId && <><dt className="text-muted-foreground">所属项目</dt><dd><button className="text-primary hover:underline" onClick={onOpenProject}>查看项目详情</button></dd></>}
          {task.dependsOn.length > 0 && <><dt className="text-muted-foreground">前置依赖</dt><dd className="break-all">{task.dependsOn.join('、')}</dd></>}
        </dl>
        {detail.isLoading && <p role="status" className="text-sm text-muted-foreground">正在加载详情…</p>}
        {detail.isError && <div role="alert" className="text-sm text-status-failed">详情暂时无法加载<Button variant="ghost" size="sm" onClick={() => void detail.refetch()}>重试</Button></div>}
        <section className="space-y-2"><h3 className="text-sm font-medium">任务说明</h3><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{detail.data?.description || detail.data?.summary || task.spec || '暂无补充说明'}</p></section>
        {(detail.data?.result_summary || detail.data?.result_path) && <section className="space-y-2"><h3 className="text-sm font-medium">执行结果</h3><p className="whitespace-pre-wrap break-all text-sm leading-6 text-muted-foreground">{detail.data.result_summary || detail.data.result_path}</p></section>}
        {!!detail.data?.deliverables?.length && <section className="space-y-2"><h3 className="text-sm font-medium">交付文件</h3><ul className="space-y-2">{detail.data.deliverables.map((file, i) => <li key={i} className="break-all rounded-md border border-border px-3 py-2 text-sm">{typeof file === 'string' ? file : file.name || file.path || file.description || '交付文件'}</li>)}</ul></section>}
      </div>}
    </SheetContent>
  </Sheet>;
}
