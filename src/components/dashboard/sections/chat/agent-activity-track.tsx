'use client';

import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { selectTaskList, useTaskStore, type TaskEntry } from '@/lib/task-store';
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

export function AgentActivityTrack({ roomId }: { roomId: string }) {
  const tasks = useTaskStore((s) => s.tasks);

  const roomTasks = selectTaskList(tasks).filter((task) => task.roomId === roomId);
  const activeTask = roomTasks.find((task) => isActiveStatus(task.status)) ?? roomTasks[0];

  if (!activeTask) return null;

  return (
    <div className="shrink-0 border-t border-border bg-card/20 px-3 py-2 sm:px-6">
      <div className={`mx-auto flex w-full min-w-0 items-center gap-2 ${CHAT_COLUMN_CLASS}`}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="text-xs text-muted-foreground truncate">{taskLabel(activeTask)}</span>
          <Badge variant="outline" className="text-xs h-4 px-1 shrink-0">
            {activeTask.status}
          </Badge>
        </div>
      </div>
    </div>
  );
}
