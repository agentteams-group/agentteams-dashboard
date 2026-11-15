import type { BoardTask } from '@/hooks/use-task-board';

function sameScope(a: BoardTask, b: BoardTask) {
  return a.projectId === b.projectId && a.teamId === b.teamId;
}

export function mainTasks(tasks: BoardTask[]) {
  return tasks.filter(task => !task.parentTaskId || !tasks.some(parent => sameScope(parent, task) && parent.runId === task.parentTaskId));
}

export function subtasksOf(parent: BoardTask, tasks: BoardTask[]): BoardTask[] {
  const descendants: BoardTask[] = [];
  const visited = new Set([parent.runId]);
  const collect = (id: string) => {
    for (const task of tasks) {
      if (!sameScope(parent, task) || task.parentTaskId !== id || visited.has(task.runId)) continue;
      visited.add(task.runId);
      descendants.push(task);
      collect(task.runId);
    }
  };
  collect(parent.runId);
  return descendants;
}

export function subtaskProgress(parent: BoardTask, tasks: BoardTask[]) {
  const children = subtasksOf(parent, tasks);
  const completed = children.filter(task => task.status === 'completed').length;
  return { total: children.length, completed, percent: children.length ? Math.round(completed / children.length * 100) : 0 };
}
