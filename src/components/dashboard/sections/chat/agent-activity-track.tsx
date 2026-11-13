'use client';

import { useState } from 'react';
import { Activity, ShieldAlert, MessageSquare, ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { selectTaskList, useTaskStore, type TaskEntry } from '@/lib/task-store';
import { selectConfirmationList, useHitlInboxStore, type HitlConfirmation } from '@/lib/hitl-inbox';
import { CHAT_COLUMN_CLASS } from './layout';

function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'running' || s === 'in_progress' || s === 'pending' || s === 'active';
}

function taskLabel(task: TaskEntry): string {
  const done = task.steps.filter((step) => {
    const status = (step.status ?? '').toLowerCase();
    return status === 'done' || status === 'completed' || status === 'success';
  }).length;
  if (task.steps.length > 0) return `${task.title} · ${done}/${task.steps.length}`;
  return task.title;
}

export function AgentActivityTrack({ roomId, onReveal }: { roomId: string; onReveal?: (_eventId: string) => boolean }) {
  const [unavailableEventId, setUnavailableEventId] = useState<string | null>(null);
  const tasks = useTaskStore((s) => s.tasks);
  const confirmationsMap = useHitlInboxStore((s) => s.confirmations);
  const resolutions = useHitlInboxStore((s) => s.resolutions);

  const roomTasks = selectTaskList(tasks).filter((task) => task.roomId === roomId);
  const activeTask = roomTasks.find((task) => isActiveStatus(task.status)) ?? roomTasks[0];
  const confirmations = selectConfirmationList(confirmationsMap).filter((item) => item.roomId === roomId && resolutions[item.id]?.status !== 'submitted');
  const pending = confirmations[0] as HitlConfirmation | undefined;

  if (!activeTask && !pending) return null;

  return (
    <div className="shrink-0 border-t border-border bg-card/20 px-3 py-2 sm:px-6">
      <div className={`mx-auto flex w-full min-w-0 items-center gap-2 ${CHAT_COLUMN_CLASS}`}>
      {pending ? (
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3 rounded-lg bg-amber-500/5 px-3 py-2">
            {pending.question ? <MessageSquare className="size-4 shrink-0 text-amber-600" aria-hidden="true" /> : <ShieldAlert className="size-4 shrink-0 text-amber-600" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">{pending.question ? '有问题等你回答' : '有操作等你审批'}{confirmations.length > 1 && <span className="ml-2 font-normal text-muted-foreground">共 {confirmations.length} 项待处理</span>}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={pending.question ?? '查看具体操作后，选择批准或拒绝。'}>{pending.question ?? '查看具体操作后，选择批准或拒绝。'}</p>
            </div>
            {onReveal && <button type="button" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setUnavailableEventId(onReveal(pending.eventId) ? null : pending.eventId)}>{pending.question ? '查看问题' : '查看审批'}<ArrowUpRight className="size-3.5" aria-hidden="true" /></button>}
          </div>
          {unavailableEventId === pending.eventId && <p role="status" className="px-3 pt-1.5 text-xs text-muted-foreground">该请求在更早的消息中，请加载更早消息后查看。</p>}
        </div>
      ) : activeTask ? (
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="text-xs text-muted-foreground truncate">{taskLabel(activeTask)}</span>
          <Badge variant="outline" className="text-xs h-4 px-1 shrink-0">
            {activeTask.status}
          </Badge>
        </div>
      ) : null}
      </div>
    </div>
  );
}
