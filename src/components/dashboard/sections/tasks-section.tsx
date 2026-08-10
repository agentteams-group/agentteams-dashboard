'use client';

import { useMemo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { motion } from 'framer-motion';
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
import {
  useTaskStore,
  selectTaskList,
  type TaskEntry,
} from '@/lib/task-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useActiveSection } from '@/components/dashboard/use-active-section';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useTeamTasks, mergeTasks, useLogTeamTaskScan } from '@/hooks/use-team-tasks';
import {
  actorFromManager,
  actorFromWorker,
  actorFromTeam,
  actorAsLeader,
} from '@/lib/task-actors';
import type { WorkflowItem } from '@/lib/a2ui/workflow';

const COMPLETE_STATUSES = new Set(['completed', 'success', 'done']);
const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);
const RUNNING_STATUSES = new Set(['in_progress', 'running']);

type StatusFilter = 'all' | 'running' | 'completed' | 'failed';
type PerspectiveKind = 'all' | 'manager' | 'leader' | 'team' | 'worker';

function taskStatus(task: TaskEntry): StatusFilter {
  if (COMPLETE_STATUSES.has(task.status)) return 'completed';
  if (ERROR_STATUSES.has(task.status)) return 'failed';
  if (RUNNING_STATUSES.has(task.status)) return 'running';
  return 'all';
}

function statusLabel(status?: string): string {
  if (!status) return '等待中';
  if (COMPLETE_STATUSES.has(status)) return '已完成';
  if (ERROR_STATUSES.has(status)) return '失败';
  if (RUNNING_STATUSES.has(status)) return '进行中';
  return status;
}

function statusClass(status?: string): string {
  if (!status) return 'bg-muted text-muted-foreground';
  if (COMPLETE_STATUSES.has(status)) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
  if (ERROR_STATUSES.has(status)) return 'bg-red-500/15 text-red-700 dark:text-red-400';
  if (RUNNING_STATUSES.has(status)) return 'bg-violet-500/15 text-violet-700 dark:text-violet-400';
  return 'bg-muted text-muted-foreground';
}

function StatusBadge({ status }: { status?: string }) {
  return <Badge className={statusClass(status)}>{statusLabel(status)}</Badge>;
}

function roomDisplayName(roomId: string): string {
  const parts = roomId.split(':');
  const local = parts[0]?.replace(/^!/, '') || roomId;
  return local.length > 24 ? local.slice(0, 22) + '...' : local;
}

interface ActorContext {
  /** Resolve a Matrix user id to a Manager name. */
  managerByUserId: Map<string, string>;
  /** Resolve a Matrix user id to a Worker name. */
  workerByUserId: Map<string, string>;
  /** Resolve a Matrix room id to a Manager name. */
  managerByRoomId: Map<string, string>;
  /** Resolve a Matrix room id to a Team name. */
  teamByRoomId: Map<string, string>;
  /** Resolve a Matrix room id to a Worker name. */
  workerByRoomId: Map<string, string>;
}

function buildActorContext(
  managers: { name: string; matrixUserID?: string; roomID?: string; leaderDMRoomID?: string }[] | undefined,
  workers: { name: string; matrixUserID?: string; roomID?: string; team?: string }[] | undefined,
  teams: { teamName: string; teamRoomID?: string; leaderDMRoomID?: string; workerNames?: string[] }[] | undefined,
): ActorContext {
  const managerByUserId = new Map<string, string>();
  const workerByUserId = new Map<string, string>();
  const managerByRoomId = new Map<string, string>();
  const teamByRoomId = new Map<string, string>();
  const workerByRoomId = new Map<string, string>();

  for (const m of managers ?? []) {
    if (m.matrixUserID) managerByUserId.set(m.matrixUserID, m.name);
    if (m.roomID) managerByRoomId.set(m.roomID, m.name);
    if (m.leaderDMRoomID) managerByRoomId.set(m.leaderDMRoomID, m.name);
  }
  // Index workers by team first for fallback resolution
  const workerByTeam = new Map<string, string[]>();
  for (const w of workers ?? []) {
    if (w.matrixUserID) workerByUserId.set(w.matrixUserID, w.name);
    if (w.roomID) workerByRoomId.set(w.roomID, w.name);
    if (w.team) {
      const list = workerByTeam.get(w.team) ?? [];
      list.push(w.name);
      workerByTeam.set(w.team, list);
    }
  }
  for (const t of teams ?? []) {
    if (t.teamRoomID) teamByRoomId.set(t.teamRoomID, t.teamName);
    if (t.leaderDMRoomID) teamByRoomId.set(t.leaderDMRoomID, t.teamName);
    for (const wn of t.workerNames ?? []) {
      // Mark team ownership for workers that don't have their own room mapping yet
      // (some workflows target the team room, not a specific worker room)
    }
    void workerByTeam;
  }

  return {
    managerByUserId,
    workerByUserId,
    managerByRoomId,
    teamByRoomId,
    workerByRoomId,
  };
}

function TaskDetail({
  task,
  actors,
}: {
  task: TaskEntry;
  actors: ActorContext;
}) {
  const completedSteps = task.steps.filter((s) => COMPLETE_STATUSES.has(s.status || '')).length;
  const managerName = actors.managerByUserId.get(task.senderMatrixUserId);
  const roomManagerName = actors.managerByRoomId.get(task.roomId);
  const roomTeamName = actors.teamByRoomId.get(task.roomId);
  const roomWorkerName = actors.workerByRoomId.get(task.roomId);

  return (
    <div className="space-y-4 px-3 pb-3">
      {/* Sub-agents */}
      {task.subagents.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">子智能体</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {task.subagents.map((agent, i) => (
              <div
                key={agent.id || agent.name || String(i)}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs"
              >
                <span className="truncate">{agent.title || agent.name || agent.id || `智能体 ${i + 1}`}</span>
                <StatusBadge status={agent.status || 'pending'} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps */}
      {task.steps.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">执行步骤</p>
            <span className="text-xs text-muted-foreground">
              {completedSteps}/{task.steps.length}
            </span>
          </div>
          <Progress value={(completedSteps / task.steps.length) * 100} className="mb-2" />
          <div className="space-y-1.5">
            {task.steps.map((step, i) => {
              const complete = COMPLETE_STATUSES.has(step.status || '');
              const failed = ERROR_STATUSES.has(step.status || '');
              return (
                <div
                  key={step.id || step.name || String(i)}
                  className="flex items-center gap-2 text-xs"
                >
                  {complete ? (
                    <CircleCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : failed ? (
                    <CircleX className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{step.title || step.name || `步骤 ${i + 1}`}</span>
                  <span className="text-muted-foreground">{statusLabel(step.status)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground pt-2 border-t">
        {managerName && (
          <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
            <Crown className="h-3 w-3" />
            {managerName}
          </span>
        )}
        {roomTeamName && (
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {roomTeamName}
          </span>
        )}
        {roomWorkerName && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {roomWorkerName}
          </span>
        )}
        {!managerName && roomManagerName && (
          <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
            <Crown className="h-3 w-3" />
            {roomManagerName}
          </span>
        )}
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {roomDisplayName(task.roomId)}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {new Date(task.updatedAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

interface PerspectiveState {
  kind: PerspectiveKind;
  /** Selected id (Manager name / Team name / Worker name). Empty string = "all". */
  id: string;
}

export function TasksSection() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [perspective, setPerspective] = useState<PerspectiveState>({ kind: 'all', id: '' });
  const { setActiveSection } = useActiveSection();

  const liveTasks = useTaskStore(useShallow((s) => selectTaskList(s.tasks)));
  // Persisted tasks live on MinIO under `team/{name}/tasks.json` (and a few
  // alternative layouts). MinIO data wins on conflict because it represents
  // the controller's canonical state. The hook also surfaces the file
  // discovery results for diagnostic display below.
  const {
    data: persisted,
    isLoading: persistedLoading,
    refetch: refetchPersisted,
  } = useTeamTasks({ refetchInterval: 8000 });
  const persistedTasks = persisted?.tasks ?? [];
  const tasks = useMemo(
    () => mergeTasks(persistedTasks, liveTasks),
    [persistedTasks, liveTasks],
  );
  useLogTeamTaskScan(
    persisted?.matchedPrefixes ?? [],
    persisted?.scannedKeys ?? [],
    persisted?.error,
  );

  const matrixLoggedIn = useMatrixStore((s) => s.isLoggedIn);
  const clearTasks = useTaskStore((s) => s.clearTasks);
  const [reloadKey, setReloadKey] = useState(0);

  const { data: managers } = useManagers();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();

  const actors = useMemo(
    () => buildActorContext(managers, workers, teams),
    [managers, workers, teams],
  );

  /** All task data after perspective filter, before status/search filters. */
  const perspectiveFiltered = useMemo(() => {
    if (perspective.kind === 'all' || !perspective.id) return tasks;

    if (perspective.kind === 'manager') {
      // Manager 全局视角:该 Manager 作为 sender 发出的 workflow 任务(跨 Team、跨房间)
      const mgr = (managers ?? []).find((m) => m.name === perspective.id);
      if (!mgr) return [];
      const lookup = actorFromManager(mgr);
      return tasks.filter(
        (t) => t.senderMatrixUserId === lookup.matrixUserId || lookup.roomIds.has(t.roomId),
      );
    }
    if (perspective.kind === 'leader') {
      // Leader 视角:该 Manager 领导的 Team 房间内产生的所有 workflow 任务
      // (leader 自己发的 + Worker 发的 + 其他 agent 在 Team 房间发的)
      const mgr = (managers ?? []).find((m) => m.name === perspective.id);
      if (!mgr) return [];
      const lookup = actorAsLeader(mgr, teams);
      return tasks.filter((t) => lookup.roomIds.has(t.roomId));
    }
    if (perspective.kind === 'team') {
      const team = (teams ?? []).find((t) => t.teamName === perspective.id);
      if (!team) return [];
      const lookup = actorFromTeam(team);
      return tasks.filter((t) => lookup.roomIds.has(t.roomId));
    }
    if (perspective.kind === 'worker') {
      const worker = (workers ?? []).find((w) => w.name === perspective.id);
      if (!worker) return [];
      const workerTeam = (teams ?? []).find((t) => t.teamName === worker.team);
      const lookup = actorFromWorker(worker, workerTeam);
      return tasks.filter(
        (t) => t.senderMatrixUserId === lookup.matrixUserId || lookup.roomIds.has(t.roomId),
      );
    }
    return tasks;
  }, [tasks, perspective, managers, workers, teams]);

  const filtered = useMemo(() => {
    return perspectiveFiltered.filter((t) => {
      if (statusFilter !== 'all' && taskStatus(t) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const mgrName = actors.managerByUserId.get(t.senderMatrixUserId) || '';
        if (
          !t.title.toLowerCase().includes(q) &&
          !t.runId.toLowerCase().includes(q) &&
          !mgrName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [perspectiveFiltered, statusFilter, search, actors]);

  const handleReload = useCallback(() => {
    clearTasks();
    setReloadKey((k) => k + 1);
    refetchPersisted();
  }, [clearTasks, refetchPersisted]);

  const toggleExpand = useCallback((runId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  const counts = useMemo(() => {
    let running = 0;
    let completed = 0;
    let failed = 0;
    for (const t of perspectiveFiltered) {
      const s = taskStatus(t);
      if (s === 'running') running++;
      else if (s === 'completed') completed++;
      else if (s === 'failed') failed++;
    }
    return { running, completed, failed };
  }, [perspectiveFiltered]);

  const handlePerspectiveKindChange = useCallback((kind: PerspectiveKind) => {
    setPerspective({ kind, id: '' });
  }, []);

  const perspectiveOptions = useMemo(() => {
    if (perspective.kind === 'manager' || perspective.kind === 'leader') {
      // Leader 视角:用 Manager 列表(可下钻到任意 Manager,它可能领导 0..N 个 Team)
      return (managers ?? []).map((m) => ({ value: m.name, label: m.name }));
    }
    if (perspective.kind === 'team') {
      return (teams ?? []).map((t) => ({ value: t.teamName, label: t.teamName }));
    }
    if (perspective.kind === 'worker') {
      return (workers ?? []).map((w) => ({ value: w.name, label: w.name }));
    }
    return [];
  }, [perspective.kind, managers, workers, teams]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="任务面板"
        description={
          matrixLoggedIn
            ? '实时查看 AgentTeams 任务分解与执行状态'
            : '需要先登录 Matrix 才能拉取任务数据'
        }
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground hidden sm:inline" title="持久化数据来自 MinIO，实时数据来自 Matrix workflow 消息">
              持久 {persistedTasks.length} · 实时 {liveTasks.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReload}
              disabled={persistedLoading}
              title="清空 Matrix 缓存并重新拉取 MinIO 任务文件"
            >
              <Loader2 className={`h-3.5 w-3.5 mr-1 ${persistedLoading ? 'animate-spin' : ''}`} />
              重新加载
            </Button>
          </div>
        }
      />
      {/* Reload trigger — re-renders this hidden block to force a fresh sync cycle */}
      <div data-reload-key={reloadKey} hidden />

      {/* Diagnostic banner when MinIO data source is unavailable or empty. */}
      {(persisted?.error || (persisted && !persistedLoading && persistedTasks.length === 0 && (persisted?.matchedPrefixes.length ?? 0) === 0)) && (
        <Card className="glass-card border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-start gap-2 text-xs">
            <Loader2 className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                {persisted?.error ? 'MinIO 任务数据源不可用' : 'MinIO 中未找到任务文件'}
              </p>
              <p className="text-muted-foreground">
                Bucket: <code className="font-mono">{persisted?.bucket ?? '(未配置)'}</code> ·
                候选路径: <code className="font-mono">team/, teams/, shared/teams/, shared/tasks/</code> ·
                匹配 prefix: <code className="font-mono">{persisted?.matchedPrefixes.join(', ') || '(无)'}</code>
              </p>
              {persisted?.error && (
                <p className="text-muted-foreground">错误: {persisted.error}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '进行中', count: counts.running, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/20' },
          { label: '已完成', count: counts.completed, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20' },
          { label: '失败', count: counts.failed, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20' },
        ].map((s) => (
          <Card key={s.label} className={`glass-card ${s.bg} border`}>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Perspective + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {([
            ['all', '全部', null],
            ['manager', 'Manager 全局', Crown],
            ['leader', 'Leader 团队', Users],
            ['team', 'Team', Users],
            ['worker', 'Worker', User],
          ] as const).map(([key, label, Icon]) => (
            <Button
              key={key}
              variant={perspective.kind === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => handlePerspectiveKindChange(key as PerspectiveKind)}
              title={
                key === 'manager'
                  ? '看某个 Manager 作为 sender 产生的全部任务(跨 Team)'
                  : key === 'leader'
                  ? '看某个 Manager 作为 leader 领导的 Team 房间内的所有任务'
                  : undefined
              }
            >
              {Icon && <Icon className="h-3.5 w-3.5 mr-1" />}
              {label}
            </Button>
          ))}
        </div>

        {perspective.kind !== 'all' && (
          <Select
            value={perspective.id || '__all__'}
            onValueChange={(v) => setPerspective((p) => ({ ...p, id: v === '__all__' ? '' : v }))}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="选择目标..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">
                全部
                {perspective.kind === 'manager' && ' Manager'}
                {perspective.kind === 'leader' && ' Leader'}
                {perspective.kind === 'team' && ' Team'}
                {perspective.kind === 'worker' && ' Worker'}
              </SelectItem>
              {perspectiveOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索任务名称 / Run ID / Manager 名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {([
            ['all', '全部'],
            ['running', '进行中'],
            ['completed', '已完成'],
            ['failed', '失败'],
          ] as const).map(([key, label]) => (
            <Button
              key={key}
              variant={statusFilter === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {tasks.length === 0 && (
        <Card className="glass-card">
          <CardContent className="p-12 text-center">
            <ListTodo className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            {matrixLoggedIn ? (
              <>
                <p className="text-sm font-medium">暂无任务</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Manager Agent 开始工作后，任务将自动出现在这里
                </p>
                <p className="text-xs text-muted-foreground/70 mt-3">
                  任务数据来自 Matrix 房间中的 agentteams.workflow 消息，首次同步最长需要 15 秒
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">尚未登录 Matrix</p>
                <p className="text-xs text-muted-foreground mt-1">
                  任务面板依赖 Matrix 房间消息，请先在「聊天」中登录
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
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Task list */}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((task, i) => {
            const isExpanded = expanded.has(task.runId);
            const completedSteps = task.steps.filter((s) => COMPLETE_STATUSES.has(s.status || '')).length;
            const totalSteps = task.steps.length;
            const senderName = actors.managerByUserId.get(task.senderMatrixUserId);

            return (
              <motion.div
                key={task.runId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="glass-card hover-lift overflow-hidden">
                  {/* Header row */}
                  <button
                    className="w-full text-left"
                    onClick={() => toggleExpand(task.runId)}
                  >
                    <div className="flex items-center gap-3 p-3">
                      {/* Status icon */}
                      {COMPLETE_STATUSES.has(task.status) ? (
                        <CircleCheck className="h-5 w-5 text-emerald-500 shrink-0" />
                      ) : ERROR_STATUSES.has(task.status) ? (
                        <CircleX className="h-5 w-5 text-red-500 shrink-0" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-violet-500 shrink-0" />
                      )}

                      {/* Title and meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{task.title}</span>
                          <StatusBadge status={task.status} />
                          {senderName && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/40 text-violet-600 dark:text-violet-400">
                              <Crown className="h-2.5 w-2.5 mr-0.5" />
                              {senderName}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span className="font-mono">{task.runId.slice(0, 8)}</span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {roomDisplayName(task.roomId)}
                          </span>
                          <span>{new Date(task.updatedAt).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      {/* Progress indicator */}
                      {totalSteps > 0 && (
                        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                          <Progress value={(completedSteps / totalSteps) * 100} className="w-20 h-1.5" />
                          <span className="text-xs text-muted-foreground w-10 text-right">
                            {completedSteps}/{totalSteps}
                          </span>
                        </div>
                      )}

                      {/* Expand icon */}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && <TaskDetail task={task} actors={actors} />}
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* No results after filter */}
      {tasks.length > 0 && filtered.length === 0 && (
        <Card className="glass-card">
          <CardContent className="p-8 text-center">
            <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">没有匹配的任务</p>
            {perspective.kind !== 'all' && perspective.id && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => setPerspective({ kind: 'all', id: '' })}
              >
                <Eye className="h-3.5 w-3.5 mr-1" />
                清除视角过滤
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
