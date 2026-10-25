'use client';

import { useMemo } from 'react';
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
  return <Badge className={`${className} shrink-0 text-[10px]`}>{statusLabel(status)}</Badge>;
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
          <p className="truncate font-mono text-[10px] text-muted-foreground" title={task.runId}>
            {task.runId}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      {steps.length > 0 ? (
        <ul className="space-y-1" aria-label="任务节点">
          {steps.map((step, index) => (
            <li key={step.id || `${task.runId}-${index}`} className="flex items-center gap-1.5 text-[11px]">
              <StepGlyph status={step.status} />
              <span className="min-w-0 flex-1 truncate" title={stepLabel(step, index)}>
                {stepLabel(step, index)}
              </span>
              {step.assignedTo && (
                <span className="shrink-0 text-[10px] text-muted-foreground">@{step.assignedTo}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">尚未同步到任务节点，等待 Agent 回执。</p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {steps.length > 0 ? `${completed}/${steps.length} 完成` : statusLabel(status)}
          {data && <span className="ml-1 text-emerald-600 dark:text-emerald-400">live</span>}
          {snapshotOnly && <span className="ml-1 text-amber-600 dark:text-amber-400">快照</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-[10px]"
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

  if (tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListTodo className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-xs font-medium">本空间还没有任务消息</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Agent 在空间内发布工作流后，任务节点会按空间聚合在这里；状态来自 Controller 项目正源。
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
