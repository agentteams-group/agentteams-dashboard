'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { CircleCheck, CircleX, ExternalLink, ListTodo, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { selectTasksByRooms, useTaskStore, type TaskEntry } from '@/lib/task-store';
import { getProjectWorkflow } from '@/lib/agentteams-projects-api';
import { isProjectMiss, workflowLiveFromProject } from '@/lib/chat-workflow-live';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import type { WorkflowItem } from '@/lib/a2ui/workflow';
import type { BoardTask } from '@/hooks/use-task-board';
import { useApiTaskBoard } from '@/hooks/use-projects';
import { mainTasks, subtasksOf, subtaskProgress } from '@/lib/task-hierarchy';
import { buildTaskDag } from '@/lib/project-dag';
import { ProjectDagSvg } from '@/components/dashboard/project-dag-svg';

const COMPLETE_STATUSES = new Set(['completed', 'success', 'done']);
const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);

function statusLabel(status?: string): string {
  if (!status) return '等待中';
  if (COMPLETE_STATUSES.has(status)) return '已完成';
  if (ERROR_STATUSES.has(status)) return '失败';
  if (status === 'in_progress' || status === 'running') return '进行中';
  return status;
}

function StatusPill({ status }: { status?: string }) {
  const className = COMPLETE_STATUSES.has(status ?? '')
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    : ERROR_STATUSES.has(status ?? '')
      ? 'bg-red-500/15 text-red-700 dark:text-red-400'
      : 'bg-violet-500/15 text-violet-700 dark:text-violet-400';
  return <Badge className={`${className} shrink-0 text-xs`}>{statusLabel(status)}</Badge>;
}

function StepGlyph({ status }: { status?: string }) {
  if (COMPLETE_STATUSES.has(status ?? '')) {
    return <CircleCheck className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />;
  }
  if (ERROR_STATUSES.has(status ?? '')) {
    return <CircleX className="h-3 w-3 shrink-0 text-red-500" aria-hidden="true" />;
  }
  if (status === 'in_progress' || status === 'running') {
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-500" aria-hidden="true" />;
  }
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50" aria-hidden="true" />;
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
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold" title={title}>{title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={task.runId}>
            {task.runId}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

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
          {data && <span className="ml-1 text-emerald-600 dark:text-emerald-400">live</span>}
          {snapshotOnly && <span className="ml-1 text-amber-600 dark:text-amber-400">快照</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-xs"
          onClick={openProjectDetail}
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          任务中心
        </Button>
      </div>
    </div>
  );
}

/**
 * 房间「任务」tab：只聚合本房间真实产生的工作流消息（TaskStore 由全局
 * /sync 写入）。底座没有「按房间查任务」的服务端接口，因此不按项目/团队
 * 反查，避免把别的房间的任务塞进来；空态明确说明数据来源。
 */
export function RoomTasksPanel({ roomId }: { roomId: string }) {
  const roomIds = useMemo(() => new Set([roomId]), [roomId]);
  const tasks = useTaskStore(useShallow((state) => selectTasksByRooms(state.tasks, roomIds)));
  const board = useApiTaskBoard();
  const boardTasks = board.tasks;
  const root = mainTasks(boardTasks).find(task => [task, ...subtasksOf(task, boardTasks)].some(child => child.executionRoomId?.replace(/^room:/, '') === roomId));

  if (root) return <RoomTaskTopology root={root} tasks={boardTasks} roomId={roomId} />;

  if (tasks.length === 0) {
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
    <div className="h-full space-y-2 overflow-y-auto custom-scrollbar p-2">
      {tasks.map((task) => (
        <RoomTaskCard key={task.runId} task={task} />
      ))}
    </div>
  );
}

function RoomTaskTopology({ root, tasks, roomId }: { root: BoardTask; tasks: BoardTask[]; roomId: string }) {
  const [selectedId, setSelectedId] = useState(root.runId);
  const children = subtasksOf(root, tasks);
  const family = [root, ...children];
  const ids = new Set(family.map(task => task.runId));
  const dag = buildTaskDag(family.map(task => ({ ...task, dependsOn: task.dependsOn.some(id => ids.has(id)) ? task.dependsOn.filter(id => ids.has(id)) : task.parentTaskId && ids.has(task.parentTaskId) ? [task.parentTaskId] : [] })));
  const selected = family.find(task => task.runId === selectedId) ?? root;
  const progress = subtaskProgress(root, tasks);
  const colors = { unknown: { fill: 'var(--muted)', stroke: 'var(--border)', text: 'var(--foreground)' } };
  const labels: Record<string, string> = { pending: '待办', assigned: '已派发', in_progress: '执行中', submitted: '待验收', completed: '已完成', blocked: '阻塞', revision: '需修订', failed: '失败' };
  return <div className="h-full overflow-auto space-y-3 p-4">
    <h3 className="text-sm font-semibold">任务拓扑（依赖关系）<span className="ml-2 font-normal text-muted-foreground">{root.title}</span></h3>
    {children.length > 0 && <div className="space-y-2 text-xs text-muted-foreground"><div className="flex justify-between"><span>子任务 {progress.completed}/{progress.total} 已完成</span><span>{progress.percent}%</span></div><progress className="h-1.5 w-full accent-primary" aria-label="子任务进度" max={100} value={progress.percent} /></div>}
    <p className="text-xs text-muted-foreground">顶部为主任务，下方展示子任务及前置依赖。点击节点查看状态和执行者。</p>
    <div className="flex justify-center overflow-auto rounded-xl border border-border/60 bg-muted/10 p-3"><ProjectDagSvg dag={dag} nodeColors={colors} statusLabels={labels} neutral nodeWidth={220} nodeHeight={40} gapY={84} title="任务拓扑" selectedNodeId={selected.runId} currentNodeId={family.find(task => task.executionRoomId?.replace(/^room:/, '') === roomId)?.runId} onNodeClick={setSelectedId} /></div>
    <div className="space-y-2 border-t pt-3 text-sm"><p className="font-medium">{selected.title}</p><p>{labels[selected.status] ?? selected.status} · {selected.assignedTo || '未分配'}</p></div>
  </div>;
}
