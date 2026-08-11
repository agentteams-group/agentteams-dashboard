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
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Crown,
  User,
  Users,
  Eye,
  FolderTree,
  Layers,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Database,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
import { useMatrixStore } from '@/lib/matrix-store';
import { useActiveSection } from '@/components/dashboard/use-active-section';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import {
  useMergedTaskBoard,
  useLogTaskBoardScan,
  type BoardTask,
  type BoardProject,
  type TaskStatus,
  type ProjectStatus,
  type PlanItem,
} from '@/hooks/use-task-board';
import { useTaskStore } from '@/lib/task-store';

// ----- Status config -----

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
    color: 'text-slate-500 bg-slate-500/10 border-slate-500/30',
    icon: Clock,
  },
  {
    key: 'assigned',
    label: '已派发',
    description: '已发给 Worker,等待首次心跳',
    color: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
    icon: ChevronUp,
  },
  {
    key: 'in_progress',
    label: '进行中',
    description: 'Worker 正在执行',
    color: 'text-violet-500 bg-violet-500/10 border-violet-500/30',
    icon: Loader2,
  },
  {
    key: 'completed',
    label: '已完成',
    description: 'Worker 报完成,Manager 已确认',
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
    icon: CircleCheck,
  },
  {
    key: 'failed',
    label: '失败',
    description: '执行失败,需要人工介入',
    color: 'text-red-500 bg-red-500/10 border-red-500/30',
    icon: CircleX,
  },
  {
    key: 'blocked',
    label: '阻塞',
    description: '等待依赖项完成或外部解锁',
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
    icon: AlertTriangle,
  },
  {
    key: 'unknown',
    label: '未知',
    description: '状态未知',
    color: 'text-gray-500 bg-gray-500/10 border-gray-500/30',
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

const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  active: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

const OUTCOME_COLOR: Record<NonNullable<BoardTask['outcome']>, string> = {
  SUCCESS: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  SUCCESS_WITH_NOTES:
    'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
  REVISION_NEEDED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  BLOCKED: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
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
    return <Badge variant="outline" className="text-[10px]">未知</Badge>;
  }
  const Icon = cfg.icon;
  return (
    <Badge className={`text-[10px] gap-1 border ${cfg.color}`}>
      <Icon className={`h-2.5 w-2.5 ${status === 'in_progress' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </Badge>
  );
}

function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={`text-[10px] border ${PROJECT_STATUS_COLOR[status]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </Badge>
  );
}

function OutcomeBadge({ outcome }: { outcome: BoardTask['outcome'] }) {
  if (!outcome) return null;
  return (
    <Badge className={`text-[10px] border ${OUTCOME_COLOR[outcome]}`}>
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
  onClick,
}: {
  task: BoardTask;
  managerName?: string;
  workerTeam?: string;
  highlightProjectId?: string;
  onClick?: () => void;
}) {
  const expanded = highlightProjectId === task.projectId;
  return (
    <Card
      onClick={onClick}
      className={`glass-card hover-lift cursor-pointer transition-all ${
        expanded ? 'border-violet-500/40' : ''
      }`}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <StatusBadge status={task.status} />
          {task.outcome && <OutcomeBadge outcome={task.outcome} />}
          {task.dependsOn.length > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
              title={`依赖 ${task.dependsOn.length} 个前置任务`}
            >
              <Layers className="h-2.5 w-2.5" />
              ×{task.dependsOn.length}
            </Badge>
          )}
        </div>
        <div>
          <p className="text-sm font-medium leading-snug">{task.title}</p>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {shortId(task.runId, 22)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          {task.assignedTo && (
            <span className="flex items-center gap-1">
              {managerName ? (
                <>
                  <Crown className="h-3 w-3 text-violet-500" />
                  <span className="text-violet-600 dark:text-violet-400">{managerName}</span>
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
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <MessageSquare className="h-2.5 w-2.5" />
            <span className="font-mono truncate">{shortId(task.roomId, 24)}</span>
          </div>
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
}: {
  project: BoardProject;
  taskCount: number;
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  const allItems = project.phases.flatMap((p) => p.items);
  const done = allItems.filter((i) => i.done).length;
  const total = allItems.length;
  const inProgress = allItems.filter((i) => i.inProgress).length;
  const blocked = allItems.filter((i) => i.blocked).length;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Card
      onClick={() => onSelect(project.runId)}
      className={`glass-card hover-lift cursor-pointer transition-all ${
        selected ? 'border-violet-500/50 ring-1 ring-violet-500/30' : ''
      }`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2 flex-wrap">
          <ProjectStatusBadge status={project.status} />
          <Badge variant="outline" className="text-[10px] gap-1">
            <Layers className="h-2.5 w-2.5" />
            {project.phases.length} 阶段
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1">
            <ListTodo className="h-2.5 w-2.5" />
            {taskCount} 任务
          </Badge>
        </div>
        <div>
          <p className="text-sm font-semibold">{project.name}</p>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {project.runId}
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>plan 进度</span>
            <span>
              {done}/{total} · {progressPct}%
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          {project.leader && (
            <span className="flex items-center gap-1">
              <Crown className="h-3 w-3 text-violet-500" />
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
            <span className="text-[10px] text-muted-foreground/70 font-normal">
              {phase.items.filter((i) => i.done).length}/{phase.items.length}
            </span>
          </p>
          <div className="space-y-1">
            {phase.items.length === 0 ? (
              <p className="text-[10px] text-muted-foreground italic">无子任务</p>
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

// ----- Main section -----

type ViewMode = 'kanban' | 'projects';

export function TasksSection() {
  const { setActiveSection } = useActiveSection();
  const matrixLoggedIn = useMatrixStore((s) => s.isLoggedIn);
  const clearTasks = useTaskStore((s) => s.clearTasks);
  const liveCount = useTaskStore(useShallow((s) => Object.keys(s.tasks).length));

  const board = useMergedTaskBoard({ refetchInterval: 8000 });
  useLogTaskBoardScan(
    board.matchedPrefixes,
    board.scannedKeys,
    board.bucket,
    board.error,
  );

  const { data: managers } = useManagers();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();

  const [view, setView] = useState<ViewMode>('kanban');
  const [search, setSearch] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleReload = useCallback(() => {
    clearTasks();
    setReloadKey((k) => k + 1);
    board.refetch();
  }, [clearTasks, board]);

  // Auto-select the first project when projects are loaded and nothing
  // is selected yet.
  useEffect(() => {
    if (selectedProjectId) return;
    if (board.projects.length > 0) {
      setSelectedProjectId(board.projects[0].runId);
    }
  }, [board.projects, selectedProjectId]);

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
    for (const t of board.tasks) {
      if (t.status === 'in_progress' || t.status === 'assigned') running++;
      else if (t.status === 'completed') completed++;
      else if (t.status === 'failed') failed++;
      else if (t.status === 'blocked') blocked++;
    }
    return { running, completed, failed, blocked, total: board.tasks.length };
  }, [board.tasks]);

  const selectedProject = board.projects.find((p) => p.runId === selectedProjectId);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="任务看板"
        description={
          matrixLoggedIn
            ? 'Manager 拆分 / Worker 执行的实时进度,以 MinIO 持久化 + Matrix 实时为双数据源'
            : '需要先登录 Matrix 才能拉取实时数据'
        }
        actions={
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] text-muted-foreground hidden sm:inline"
              title="持久 / 实时 / 项目"
            >
              持久 {board.tasks.length - liveCount} · 实时 {liveCount} · 项目 {board.projects.length}
            </span>
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
              title="清空 Matrix 缓存并重新拉取 MinIO 任务"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${board.isLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          {
            label: '进行中',
            count: counts.running,
            color: 'text-violet-500',
            bg: 'bg-violet-500/10 border-violet-500/20',
          },
          {
            label: '已完成',
            count: counts.completed,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10 border-emerald-500/20',
          },
          {
            label: '阻塞',
            count: counts.blocked,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10 border-amber-500/20',
          },
          {
            label: '失败',
            count: counts.failed,
            color: 'text-red-500',
            bg: 'bg-red-500/10 border-red-500/20',
          },
        ].map((s) => (
          <Card key={s.label} className={`glass-card ${s.bg} border`}>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Diagnostic banner */}
      {board.bucket && board.scannedKeys.length === 0 && !board.isLoading && (
        <Card className="glass-card border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-start gap-2 text-xs">
            <Database className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                MinIO 暂未发现任务数据
              </p>
              <p className="text-muted-foreground">
                Bucket <code className="font-mono">{board.bucket}</code> · 扫描路径{' '}
                <code className="font-mono">shared/tasks/, shared/projects/, agents/*/task-history.json</code>
                {board.matchedPrefixes.length > 0 && (
                  <>
                    {' '}· 匹配:{' '}
                    <code className="font-mono">{board.matchedPrefixes.join(', ')}</code>
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

      {/* View: Kanban (status columns) */}
      {view === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {TASK_STATUS_COLUMNS.map((col) => {
            const list = tasksByStatus.get(col.key) ?? [];
            const Icon = col.icon;
            return (
              <div
                key={col.key}
                className={`rounded-lg border ${col.color} p-3 min-h-[300px] flex flex-col gap-2`}
              >
                <div className="flex items-center gap-1.5 pb-1 border-b border-current/10">
                  <Icon className={`h-3.5 w-3.5 ${col.key === 'in_progress' ? 'animate-spin' : ''}`} />
                  <p className="text-xs font-semibold">{col.label}</p>
                  <span className="ml-auto text-[10px] font-mono opacity-70">{list.length}</span>
                </div>
                <div className="space-y-2 flex-1">
                  <AnimatePresence initial={false}>
                    {list.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground italic text-center py-4">
                        无
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
                              highlightProjectId={selectedProjectId ?? undefined}
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

      {/* View: Projects (cards + selected project plan) */}
      {view === 'projects' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-3">
            {board.projects.length === 0 ? (
              <Card className="glass-card">
                <CardContent className="p-8 text-center">
                  <FolderTree className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">暂无项目</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Manager 创建项目后会写入{' '}
                    <code className="font-mono">shared/projects/&#123;id&#125;/meta.json</code>
                  </p>
                </CardContent>
              </Card>
            ) : (
              board.projects.map((p) => (
                <ProjectCard
                  key={p.runId}
                  project={p}
                  taskCount={tasksForProject(p.runId).length}
                  onSelect={setSelectedProjectId}
                  selected={p.runId === selectedProjectId}
                />
              ))
            )}
          </div>
          <div className="lg:col-span-2">
            {selectedProject ? (
              <Card className="glass-card">
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold">{selectedProject.name}</h3>
                      <ProjectStatusBadge status={selectedProject.status} />
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {selectedProject.runId}
                    </p>
                    {selectedProject.roomId && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        <span className="font-mono">{selectedProject.roomId}</span>
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">执行计划</p>
                    <ProjectPlanPreview project={selectedProject} />
                  </div>
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
                </CardContent>
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
