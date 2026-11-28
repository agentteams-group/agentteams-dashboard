'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronUp, CircleCheck, CircleX, Clock, Eye, Loader2, MessageSquareReply, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ProjectDagSvg, type DagNodeColor } from '@/components/dashboard/project-dag-svg';
import type { BoardTask, BoardProject, TaskStatus, ProjectStatus } from '@/hooks/use-task-board';
import { apiUrl, requestJson } from '@/lib/api-base';
import { openChatRoom } from '@/lib/open-chat-room';
import { buildTaskDag, buildProjectDag } from '@/lib/project-dag';
import { OUTCOME_COLOR } from '@/lib/status-colors';
import { subtasksOf, subtaskProgress } from '@/lib/task-hierarchy';
import { awaitsLeaderReview, taskStatus } from '@/lib/task-status';
import { formatElapsedDuration } from '@/lib/assistant-task-notes';
import { CompletedTaskArchiveAction } from './chat/room-archive';
import { TaskCollaborationActions } from './task-collaboration-actions';

export const TASK_STATUS_COLUMNS: Array<{
  key: TaskStatus;
  label: string;
  description: string;
  color: string; // tailwind text/bg
  icon: typeof CircleCheck;
}> = [
  {
    key: 'pending',
    label: '待办',
    description: '已交给团队 Leader，等待分析、拆分和派发',
    color: 'text-muted-foreground bg-muted border-border',
    icon: Clock,
  },
  {
    key: 'assigned',
    label: '已派发',
    description: 'Leader 已拆分并派发给 Worker，等待接单',
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
    key: 'submitted',
    label: '待验收',
    description: '已提交结果，等待验收',
    color: 'text-status-waiting bg-status-waiting/5 border-status-waiting/15',
    icon: CircleCheck,
  },
  {
    key: 'completed',
    label: '已完成',
    description: 'Worker 报完成,Manager 已确认',
    color: 'text-status-done bg-status-done/5 border-status-done/15',
    icon: CircleCheck,
  },
  {
    key: 'revision',
    label: '需修订',
    description: 'Manager 验收未通过,打回重做',
    color: 'text-status-waiting bg-status-waiting/5 border-status-waiting/15',
    icon: RotateCcw,
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
    key: 'cancelled',
    label: '已取消',
    description: '任务已终止，不再执行',
    color: 'text-muted-foreground bg-muted border-border',
    icon: CircleX,
  },
  {
    key: 'unknown',
    label: '未知',
    description: '状态未知',
    color: 'text-muted-foreground bg-muted border-border',
    icon: Eye,
  },
];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
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

export const DAG_NODE_FILL: Record<string, DagNodeColor> = {
  pending: { fill: 'rgba(148,163,184,0.12)', stroke: '#94a3b8', text: '#94a3b8' },
  assigned: { fill: 'rgba(148,163,184,0.18)', stroke: '#94a3b8', text: '#cbd5e1' },
  in_progress: { fill: 'rgba(203,147,0,0.12)', stroke: '#CB9300', text: '#CB9300' },
  submitted: { fill: 'rgba(82,125,165,0.12)', stroke: '#527DA5', text: '#527DA5' },
  revision: { fill: 'rgba(245,158,11,0.14)', stroke: '#f59e0b', text: '#fbbf24' },
  completed: { fill: 'rgba(0,150,106,0.12)', stroke: '#00966A', text: '#00966A' },
  failed: { fill: 'rgba(239,68,68,0.14)', stroke: '#ef4444', text: '#f87171' },
  blocked: { fill: 'rgba(249,115,22,0.14)', stroke: '#f97316', text: '#fdba74' },
  unknown: { fill: 'rgba(148,163,184,0.08)', stroke: '#64748b', text: '#94a3b8' },
};

export function StatusBadge({ status, progress }: { status: TaskStatus; progress?: { total: number; completed: number } }) {
  const cfg = TASK_STATUS_COLUMNS.find((c) => c.key === status);
  if (!cfg) {
    return <Badge variant="outline" className="text-xs">未知</Badge>;
  }
  const reviewing = awaitsLeaderReview(status, progress);
  const Icon = reviewing ? Eye : cfg.icon;
  const presentation = taskStatus(status, progress);
  return (
    <Badge variant="outline" className="text-xs gap-1.5" style={{ color: presentation.color, borderColor: `color-mix(in srgb, ${presentation.color} 25%, transparent)`, backgroundColor: `color-mix(in srgb, ${presentation.color} 9%, transparent)` }}>
      <Icon className={`h-3 w-3 ${status === 'in_progress' && !reviewing ? 'motion-safe:animate-spin' : ''}`} />
      {presentation.label}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: BoardTask['outcome'] }) {
  if (!outcome) return null;
  return (
    <Badge className={`text-xs border ${OUTCOME_COLOR[outcome]}`}>
      {OUTCOME_LABEL[outcome]}
    </Badge>
  );
}

export function TaskRoomActions({ task, tasks = [], compact = false }: { task: BoardTask; tasks?: BoardTask[]; compact?: boolean }) {
  const queryClient = useQueryClient();
  const children = subtasksOf(task, tasks);
  return <TaskCollaborationActions task={task} tasks={tasks} compact={compact}>
      {task.roomId && <Button variant="ghost" size={compact ? 'icon' : 'sm'} className={compact ? 'size-8 text-muted-foreground' : 'text-xs text-muted-foreground'} aria-label="查看来源会话" title="查看来源会话" onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); openChatRoom(task.roomId); }}><MessageSquareReply className="size-3.5" />{!compact && '查看来源会话'}</Button>}
      {task.status === 'completed' && children.every(child => child.status === 'completed') && <CompletedTaskArchiveAction title={task.title} resolveRooms={async () => {
        const executionTasks = children.length ? children : [task];
        return Promise.all(executionTasks.map(async item => {
          if (item.executionRoomId) return item.executionRoomId.replace(/^room:/, '');
          const meta = await queryClient.fetchQuery(taskMetaQuery(item.runId, item.teamId));
          if (!meta.room_id) throw new Error('协作房间尚未创建，无法归档');
          return meta.room_id.replace(/^room:/, '');
        }));
      }} />}
  </TaskCollaborationActions>;
}

export function TaskDependencies({ task, tasks, project, showSingleTask = false }: { task: BoardTask; tasks: BoardTask[]; project?: BoardProject; showSingleTask?: boolean }) {
  const children = subtasksOf(task, tasks);
  const [selectedId, setSelectedId] = useState(task.runId);
  const dag = useMemo(() => {
    const descendants = subtasksOf(task, tasks);
    if (!descendants.length) {
      if (showSingleTask) return buildTaskDag([task]);
      return task.projectId ? buildProjectDag(tasks, task.projectId) : null;
    }
    const ids = new Set(descendants.map(child => child.runId));
    return buildTaskDag([task, ...descendants.map(child => ({ ...child, dependsOn: child.dependsOn.some(id => ids.has(id)) ? child.dependsOn.filter(id => ids.has(id)) : [task.runId] }))]);
  }, [tasks, task, showSingleTask]);
  const selected = tasks.find(item => item.runId === selectedId) ?? task;
  const graphTitle = showSingleTask ? '任务依赖图' : '项目任务分工与依赖';
  return (
    <section className="space-y-2"><h4 className="text-xs font-medium">{showSingleTask || !children.length ? graphTitle : '子任务分工与依赖'}</h4>
      {dag && dag.nodes.length > 0 ? <>
        {!children.length && project && <section aria-label="项目整体进度" className="rounded-lg bg-muted/40 px-3 py-2 text-center text-xs"><p className="truncate font-medium" title={project.name}>{project.name}</p><p className="mt-1 text-muted-foreground">项目{PROJECT_STATUS_LABEL[project.status] ?? '状态待同步'} · 已完成 {dag.nodes.filter(node => node.status === 'completed').length}/{dag.nodes.length}</p></section>}
        {dag.nodes.length > 1 && <p className="text-xs text-muted-foreground">{children.length ? '顶部为主任务；下方展示子任务及其前置依赖。' : '连线表示前置依赖，不是父子任务；前置任务完成后，下游任务才能开始。'}</p>}
        <div className="max-h-[32rem] overflow-auto rounded-xl border border-border/70 bg-muted/35 p-3 [&>svg]:mx-auto">
          <ProjectDagSvg dag={dag} nodeColors={DAG_NODE_FILL} neutral colorByStatus nodeWidth={172} nodeHeight={48} gapY={88} title={graphTitle} currentNodeId={task.runId} selectedNodeId={selectedId} onNodeClick={setSelectedId} />
        </div>
        <div className="space-y-1.5 rounded-lg border border-border/70 bg-card px-3 py-2.5 text-xs"><p className="font-medium">所选任务：{selected.title}</p><div className="flex flex-wrap items-center gap-2 text-muted-foreground"><span>{selected.assignedTo || (subtasksOf(selected, tasks).length ? '团队 Leader 协调' : '未分配')}</span><StatusBadge status={selected.status} progress={subtaskProgress(selected, tasks)} /></div></div>
      </> : <p className="text-xs text-muted-foreground">该任务暂无项目分工信息</p>}
    </section>
  );
}

interface TaskMetaDetail {
  created_at?: string | number;
  completed_at?: string | number;
  history?: Array<{ action: string; note?: string; to?: string; ts?: string }>;
  room_id?: string;
  status?: string;
  summary?: string;
  description?: string;
  spec?: string;
  spec_path?: string;
  result_summary?: string;
  result_path?: string;
  deliverables?: Array<string | { name?: string; path?: string; description?: string }>;
}

export function taskMetaQuery(taskId: string, teamId?: string) {
  const query = teamId ? `?team=${encodeURIComponent(teamId)}` : '';
  return {
    queryKey: ['task-detail', taskId, teamId],
    queryFn: () => requestJson<TaskMetaDetail>(apiUrl(`/api/agentteams/tasks/${encodeURIComponent(taskId)}/meta${query}`)),
    staleTime: 15000,
    retry: false,
  };
}

export function completedTaskDuration(task: BoardTask, meta?: TaskMetaDetail) {
  if (task.status !== 'completed') return null;
  const created = meta?.created_at ? new Date(meta.created_at).getTime() : task.createdAt;
  const completion = meta?.completed_at ?? meta?.history?.findLast(event => event.to === 'completed')?.ts;
  const completed = completion ? new Date(completion).getTime() : task.completedAt;
  return created > 0 && completed !== undefined && completed >= created
    ? formatElapsedDuration(completed - created)
    : null;
}

export function taskSummaryText(value?: string) {
  return value?.split(/\r?\n/).map(line => line.trim()).find(line => line && !/^#{1,6}\s/.test(line))
    ?.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^[-*]\s+/, '') ?? '';
}

export function SubtaskProgress({ task, tasks }: { task: BoardTask; tasks: BoardTask[] }) {
  const progress = subtaskProgress(task, tasks);
  return progress.total > 0 ? <div aria-label="子任务进度" className="space-y-1.5 text-xs text-muted-foreground"><p>子任务 {progress.completed}/{progress.total} 已完成 <span className="float-right tabular-nums">{progress.percent}%</span></p><Progress value={progress.percent} aria-label="子任务完成百分比" aria-valuenow={progress.percent} className={`h-1.5 bg-muted ${progress.completed === progress.total ? '[&_[data-slot=progress-indicator]]:bg-status-done' : '[&_[data-slot=progress-indicator]]:bg-status-running'}`} /></div> : null;
}

export function TaskDetailSheet({ task, tasks, onSelectTask, teamId, onClose, onOpenProject, restoreFocus }: {
  task: BoardTask | null;
  tasks: BoardTask[];
  onSelectTask: (_task: BoardTask) => void;
  teamId?: string;
  onClose: () => void;
  onOpenProject?: () => void;
  restoreFocus?: () => void;
}) {
  const children = task ? subtasksOf(task, tasks) : [];
  const parent = task?.parentTaskId ? tasks.find(item => item.runId === task.parentTaskId && item.projectId === task.projectId && item.teamId === task.teamId) : undefined;
  const detail = useQuery({
    ...taskMetaQuery(task?.runId ?? '', teamId),
    enabled: !!task && (task.kind === 'main' || children.length === 0) && (task.status !== 'pending' || !!task.executionRoomId),
    throwOnError: false,
  });
  const duration = task && completedTaskDuration(task, detail.data);
  const progress = task ? subtaskProgress(task, tasks) : undefined;
  const assignee = task?.assignedTo?.replace(/^@([^:]+):.+$/, '$1');
  return <Sheet open={!!task} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="sm:max-w-lg" onCloseAutoFocus={restoreFocus ? event => {
      event.preventDefault();
      restoreFocus();
    } : undefined}>
      <SheetHeader className="shrink-0 gap-2 border-b border-border bg-muted/30 pr-12">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="mr-auto">任务详情</span>{task && <StatusBadge status={detail.data?.status === 'submitted' ? 'submitted' : task.status} progress={progress} />}</div>
        <SheetTitle className="line-clamp-2 text-base leading-snug">{task?.title ?? '任务详情'}</SheetTitle>
        <SheetDescription className="line-clamp-1">{taskSummaryText(detail.data?.summary || detail.data?.description || task?.spec) || '查看任务状态、执行说明与交付结果'}</SheetDescription>
        {task && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="min-w-0 truncate" title={task.assignedTo}>负责人 {assignee || '待分配'}</span>{!!progress?.total && <span className="ml-auto tabular-nums">子任务 {progress.completed}/{progress.total} 已完成</span>}{duration && <span>耗时 {duration}</span>}</div>}
      </SheetHeader>
      {task && <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 custom-scrollbar">
        {parent && <Button variant="ghost" size="sm" onClick={() => onSelectTask(parent)}>返回主任务：{parent.title}</Button>}
        {children.length > 0 && <section aria-label="子任务列表" className="space-y-2"><h3 className="text-sm font-medium">子任务（{children.length}）</h3>{children.map(child => <button key={child.runId} className="flex w-full items-start justify-between gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/40" onClick={() => onSelectTask(child)}><span className="min-w-0 text-sm"><span className="block">{child.title}</span><span className="mt-1 block text-xs text-muted-foreground">{child.assignedTo || '未分配'}</span></span><StatusBadge status={child.status} /></button>)}</section>}
        {task.outcome && <OutcomeBadge outcome={task.outcome} />}
        <TaskRoomActions task={{ ...task, teamId: task.teamId ?? teamId }} tasks={tasks} />
        <dl className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-3 text-sm">
          {duration && <><dt className="text-muted-foreground">总耗时</dt><dd>{duration}</dd></>}
          <dt className="text-muted-foreground">负责人</dt><dd>{task.assignedTo || (children.length ? '团队 Leader 协调' : '未分配')}</dd>
          <dt className="text-muted-foreground">任务编号</dt><dd className="break-all font-mono text-xs">{task.runId}</dd>
          {task.projectId && onOpenProject && <><dt className="text-muted-foreground">所属项目</dt><dd><button className="text-primary hover:underline" onClick={onOpenProject}>查看项目详情</button></dd></>}
          {task.dependsOn.length > 0 && <><dt className="text-muted-foreground">前置依赖</dt><dd className="break-all">{task.dependsOn.join('、')}</dd></>}
        </dl>
        {detail.isLoading && <p role="status" className="text-sm text-muted-foreground">正在加载详情…</p>}
        {detail.isError && <div role="alert" className="text-sm text-status-failed">详情暂时无法加载<Button variant="ghost" size="sm" onClick={() => void detail.refetch()}>重试</Button></div>}
        <TaskDependencies key={task.runId} task={task} tasks={tasks} />
        <section className="space-y-2"><h3 className="text-sm font-medium">任务说明</h3><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{detail.data?.description || detail.data?.spec || detail.data?.summary || task.spec || '暂无补充说明'}</p></section>
        {(detail.data?.result_summary || detail.data?.result_path) && <section className="space-y-2"><h3 className="text-sm font-medium">执行结果</h3><p className="whitespace-pre-wrap break-all text-sm leading-6 text-muted-foreground">{detail.data.result_summary || detail.data.result_path}</p></section>}
        {!!detail.data?.deliverables?.length && <section className="space-y-2"><h3 className="text-sm font-medium">交付文件</h3><ul className="space-y-2">{detail.data.deliverables.map((file, i) => <li key={i} className="break-all rounded-md border border-border px-3 py-2 text-sm">{typeof file === 'string' ? file : file.name || file.path || file.description || '交付文件'}</li>)}</ul></section>}
      </div>}
    </SheetContent>
  </Sheet>;
}
