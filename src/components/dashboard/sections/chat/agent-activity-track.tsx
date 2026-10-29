'use client';

import { Activity, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { selectTaskList, useTaskStore, type TaskEntry } from '@/lib/task-store';
import { selectConfirmationList, useHitlInboxStore, type HitlConfirmation } from '@/lib/hitl-inbox';

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

export function AgentActivityTrack({ roomId }: { roomId: string }) {
  const tasks = useTaskStore((s) => s.tasks);
  const confirmationsMap = useHitlInboxStore((s) => s.confirmations);

  const roomTasks = selectTaskList(tasks).filter((task) => task.roomId === roomId);
  const activeTask = roomTasks.find((task) => isActiveStatus(task.status)) ?? roomTasks[0];
  const confirmations = selectConfirmationList(confirmationsMap).filter((item) => item.roomId === roomId);
  const pending = confirmations[0] as HitlConfirmation | undefined;

  if (!activeTask && !pending) return null;

  return (
    <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-1.5 flex items-center gap-2 min-w-0">
      {pending ? (
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-700 dark:text-amber-400 truncate">
            待确认 {pending.toolName}
            {pending.triggeredBy ? ` · ${pending.triggeredBy}` : ''}
          </span>
          <Badge variant="outline" className="text-xs h-4 px-1 border-amber-500/40 text-amber-600 shrink-0">
            HITL
          </Badge>
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
  );
}
