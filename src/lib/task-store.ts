import { create } from 'zustand';
import type { WorkflowItem } from '@/lib/a2ui/workflow';

export interface TaskEntry {
  runId: string;
  title: string;
  status: string;
  roomId: string;
  subagents: WorkflowItem[];
  steps: WorkflowItem[];
  updatedAt: number;
}

interface TaskStore {
  tasks: Record<string, TaskEntry>;
  upsertTask: (task: Omit<TaskEntry, 'updatedAt'>) => void;
  clearTasks: () => void;
}

export const useTaskStore = create<TaskStore>()((set) => ({
  tasks: {},

  upsertTask: (task) =>
    set((state) => {
      const existing = state.tasks[task.runId];
      // Only update if this is newer or if we have more steps/subagents data
      const hasMoreData =
        !existing ||
        task.subagents.length > existing.subagents.length ||
        task.steps.length > existing.steps.length ||
        task.status !== existing.status;

      if (!hasMoreData && existing) return state;

      return {
        tasks: {
          ...state.tasks,
          [task.runId]: {
            ...task,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  clearTasks: () => set({ tasks: {} }),
}));

/** Derive a sorted task list from the store. */
export function selectTaskList(tasks: Record<string, TaskEntry>): TaskEntry[] {
  return Object.values(tasks).sort((a, b) => b.updatedAt - a.updatedAt);
}
