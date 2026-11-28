'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { CircleCheck, CircleX, Eye, ListTodo, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { selectTasksByRooms, useTaskStore, type TaskEntry } from '@/lib/task-store';
import { getProjectWorkflow } from '@/lib/agentteams-projects-api';
import { isProjectMiss, workflowLiveFromProject } from '@/lib/chat-workflow-live';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import type { WorkflowItem } from '@/lib/a2ui/workflow';
import type { BoardTask } from '@/hooks/use-task-board';
import { useApiTaskBoard } from '@/hooks/use-projects';
import { mainTasks, subtasksOf, subtaskProgress } from '@/lib/task-hierarchy';
import { TASK_STATUS, awaitsLeaderReview, taskStatus } from '@/lib/task-status';
import { TaskCollaborationActions } from '../../task-collaboration-actions';
import { completedTaskDuration, TaskDetailSheet, taskMetaQuery } from '../../task-detail-sheet';

const COMPLETE_STATUSES = new Set(['completed', 'success', 'done']);
const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);

function statusLabel(status?: string): string {
  return taskStatus(status).label;
}

function StatusPill({ status, progress }: { status?: string; progress?: { total: number; completed: number } }) {
  const presentation = taskStatus(status, progress);
  return <Badge variant="outline" className="shrink-0 gap-1.5 text-xs" style={{ color: presentation.color, borderColor: `color-mix(in srgb, ${presentation.color} 25%, transparent)`, backgroundColor: `color-mix(in srgb, ${presentation.color} 9%, transparent)` }}>{awaitsLeaderReview(status, progress) ? <Eye className="size-3" /> : <StepGlyph status={status} />}{presentation.label}</Badge>;
}

function StepGlyph({ status }: { status?: string }) {
  if (COMPLETE_STATUSES.has(status ?? '')) {
    return <CircleCheck style={{ color: TASK_STATUS.completed.color }} className="h-3 w-3 shrink-0" aria-hidden="true" />;
  }
  if (ERROR_STATUSES.has(status ?? '')) {
    return <CircleX style={{ color: TASK_STATUS.failed.color }} className="h-3 w-3 shrink-0" aria-hidden="true" />;
  }
  if (status === 'in_progress' || status === 'running') {
    return <Loader2 style={{ color: TASK_STATUS.in_progress.color }} className="h-3 w-3 shrink-0 motion-safe:animate-spin" aria-hidden="true" />;
  }
  return <span style={{ backgroundColor: taskStatus(status).color }} className="h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden="true" />;
}

function stepLabel(step: WorkflowItem, index: number): string {
  return step.title || step.name || step.id || `步骤 ${index + 1}`;
}

/**
 * 房间任务卡：TaskEntry 来自本房间的 Matrix 工作流消息（底座实时事件），
 * 状态/节点用项目 workflow 正源 overlay（与接力卡同 queryKey，避免重复拉取）。
 * runId 不是项目时停探并保留消息快照 —— 不伪造项目状态。
 */
function RoomTaskCard({ task }: { task: TaskEntry }) {
  const { data, isError, error } = useQuery({
    queryKey: ['chat-workflow-live', String(task.runId)],
    queryFn: () => getProjectWorkflow(task.runId, { includeTasks: true }),
    refetchInterval: (query) => (isProjectMiss(query.state.error) ? false : 15000),
    retry: false,
    staleTime: 5000,
  });
  const live = data ? workflowLiveFromProject(data) : null;
  const steps = live && live.steps.length > 0 ? live.steps : task.steps;
  const status = live?.status ?? task.status;
  const title = live?.title || task.title;
  const completed = steps.filter((step) => COMPLETE_STATUSES.has(step.status ?? '')).length;
  const snapshotOnly = isError && !isProjectMiss(error);

  const openProjectDetail = () => {
    useHitlInboxStore.getState().setPendingProjectKey({
      id: data?.project_id || task.runId,
      ...(data?.team_id ? { team: data.team_id } : {}),
    });
    useSectionStore.getState().setActiveSection('tasks');
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug" title={title}>{title}</p>
        </div>
        <StatusPill status={status} progress={{ total: steps.length, completed }} />
      </div>

      <div className="space-y-1 text-xs text-muted-foreground"><div className="flex justify-between"><span>子任务 {completed}/{steps.length} 已完成</span><span>{steps.length ? Math.round(completed / steps.length * 100) : COMPLETE_STATUSES.has(status ?? '') ? 100 : 0}%</span></div><progress aria-label="子任务进度" max={steps.length || 1} value={steps.length ? completed : COMPLETE_STATUSES.has(status ?? '') ? 1 : 0} className="h-1.5 w-full accent-[var(--action-primary)]" /></div>

      {steps.length > 0 ? (
        <ul className="space-y-1" aria-label="任务节点">
          {steps.map((step, index) => (
            <li key={step.id || `${task.runId}-${index}`} className="flex items-center gap-1.5 text-xs">
              <StepGlyph status={step.status} />
              <span className="min-w-0 flex-1 truncate" title={stepLabel(step, index)}>
                {stepLabel(step, index)}
              </span>
              {step.assignedTo && (
                <span className="shrink-0 text-xs text-muted-foreground">@{step.assignedTo}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">尚未同步到任务节点，等待 Agent 回执。</p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {steps.length > 0 ? `${completed}/${steps.length} 完成` : statusLabel(status)}
          {data && <span className="ml-1 text-emerald-600 dark:text-emerald-400">已同步</span>}
          {snapshotOnly && <span className="ml-1 text-amber-600 dark:text-amber-400">快照</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-xs"
          onClick={openProjectDetail}
        >
          查看项目详情
        </Button>
      </div>
    </div>
  );
}

/**
 * 聚合当前来源房间或执行房间的任务；Controller 每五秒刷新，Matrix
 * 工作流消息补充尚未进入任务索引的卡片。
 */
export type RoomTaskBoard = { tasks: BoardTask[]; isLoading?: boolean; degraded?: boolean };
const EMPTY_TASK_BOARD: RoomTaskBoard = { tasks: [] };

export function useRoomTaskData(roomId: string, board: RoomTaskBoard = EMPTY_TASK_BOARD) {
  const roomIds = useMemo(() => new Set([roomId]), [roomId]);
  const tasks = useTaskStore(useShallow((state) => selectTasksByRooms(state.tasks, roomIds)));
  const roots = mainTasks(board.tasks).filter(task => task.roomId?.replace(/^room:/, '') === roomId || [task, ...subtasksOf(task, board.tasks)].some(child => child.executionRoomId?.replace(/^room:/, '') === roomId))
    .sort((a, b) => b.createdAt - a.createdAt);
  const snapshots = tasks.filter(task => !roots.some(root => root.runId === task.runId || root.projectId === task.runId));
  return { board, roots, snapshots, count: roots.length + snapshots.length };
}

export type RoomTaskData = ReturnType<typeof useRoomTaskData>;

export function RoomTasksPanel({ roomId, data }: { roomId: string; data?: RoomTaskData }) {
  return data ? <RoomTaskCards data={data} /> : <StandaloneRoomTasks roomId={roomId} />;
}

function StandaloneRoomTasks({ roomId }: { roomId: string }) {
  const board = useApiTaskBoard();
  const data = useRoomTaskData(roomId, board);
  return <RoomTaskCards data={data} />;
}

function RoomTaskCards({ data: { board, roots, snapshots } }: { data: RoomTaskData }) {
  const boardTasks = board.tasks;
  const [selection, setSelection] = useState<{ id: string; team?: string } | null>(null);
  const detailTrigger = useRef<HTMLButtonElement>(null);
  const selectedTask = boardTasks.find(task => task.runId === selection?.id && task.teamId === selection.team) ?? null;
  const selectTask = (task: BoardTask) => setSelection({ id: task.runId, team: task.teamId });

  if (roots.length === 0 && snapshots.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListTodo className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-xs font-medium">{board.isLoading ? '正在加载任务…' : board.degraded ? '任务暂时无法加载' : '本空间还没有关联任务'}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          任务派发后，这里展示主任务、子任务及其执行进展。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto bg-muted/20 p-3 custom-scrollbar">
      {roots.map(root => <RoomBoardTaskCard key={`${root.teamId ?? ''}/${root.runId}`} root={root} tasks={boardTasks} onOpenDetails={button => {
        detailTrigger.current = button;
        selectTask(root);
      }} />)}
      {snapshots.map((task) => (
        <RoomTaskCard key={task.runId} task={task} />
      ))}
      {selection && <TaskDetailSheet
        task={selectedTask}
        tasks={boardTasks}
        teamId={selectedTask?.teamId}
        onSelectTask={selectTask}
        onClose={() => setSelection(null)}
        restoreFocus={() => detailTrigger.current?.focus({ preventScroll: true })}
      />}
    </div>
  );
}

function RoomBoardTaskCard({ root, tasks, onOpenDetails }: {
  root: BoardTask;
  tasks: BoardTask[];
  onOpenDetails: (_button: HTMLButtonElement) => void;
}) {
  const knownDuration = completedTaskDuration(root);
  const detail = useQuery({
    ...taskMetaQuery(root.runId, root.teamId),
    enabled: root.status === 'completed' && !knownDuration && root.kind !== 'project-summary',
  });
  const duration = completedTaskDuration(root, detail.data);
  const progress = subtaskProgress(root, tasks);
  const percent = progress.total ? progress.percent : root.status === 'completed' ? 100 : 0;
  const active = subtasksOf(root, tasks).filter(child => child.status === 'in_progress' || child.status === 'assigned');
  return <article aria-label={root.title} className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
    <div className="space-y-3 p-3.5">
    <div className="flex items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><ListTodo className="size-4" /></span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{root.teamId || '当前会话'}</span><StatusPill status={root.status} progress={progress} /></div>
    <h3 className="line-clamp-2 text-sm font-semibold leading-snug" title={root.title}>{root.title}</h3>
    <p className="truncate text-xs text-muted-foreground" title={active.map(child => child.title).join('、')}>{active.length ? `当前阶段：${active.map(child => child.title).join('、')}` : awaitsLeaderReview(root.status, progress) ? '子任务已完成，等待 Leader 复核交付' : root.status === 'completed' ? '任务已验收，交付结果可在会话中查看' : `负责人：${root.assignedTo || '待分配'}`}</p>
    <div className="space-y-2 text-xs text-muted-foreground"><div className="flex justify-between gap-2"><span>子任务 {progress.completed}/{progress.total} 已完成</span><span className="tabular-nums">{percent}%</span></div><Progress className={`h-1.5 bg-muted ${percent === 100 ? '[&_[data-slot=progress-indicator]]:bg-status-done' : '[&_[data-slot=progress-indicator]]:bg-status-running'}`} aria-label="子任务进度" value={percent} /></div>
    {root.status === 'completed' && (
      <p className="text-xs tabular-nums text-muted-foreground">
        总耗时 {duration ?? (detail.isLoading ? '读取中…' : '暂无记录')}
      </p>
    )}
    </div>
    <div className="border-t border-border/60 bg-muted/20 px-2.5 py-2">
      <TaskCollaborationActions task={root} tasks={tasks}>
        <Button variant="ghost" size="sm" className="text-xs" onClick={event => onOpenDetails(event.currentTarget)}>
          查看详情
        </Button>
      </TaskCollaborationActions>
    </div>
  </article>;
}
