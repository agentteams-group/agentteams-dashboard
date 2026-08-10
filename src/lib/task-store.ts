import { create } from 'zustand';
import type { WorkflowItem } from '@/lib/a2ui/workflow';

export interface TaskEntry {
  runId: string;
  title: string;
  status: string;
  roomId: string;
  subagents: WorkflowItem[];
  steps: WorkflowItem[];
  updatedAt: number; // epoch ms
}

interface TaskStore {
  tasks: Record<string, TaskEntry>;
  upsertTask: (
    task: Omit<TaskEntry, 'updatedAt'>,
    timestamp?: number, // pass from caller to avoid Date.now() inside setter
  ) => void;
  clearTasks: () => void;
}

/** Processed event IDs to avoid re-processing the same event across sync cycles. */
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 500;

export const useTaskStore = create<TaskStore>()((set) => ({
  tasks: {},

  upsertTask: (task, timestamp) =>
    set((state) => {
      const existing = state.tasks[task.runId];
      // Only update if we have more steps/subagents data or a status change
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
            updatedAt: timestamp ?? Date.now(),
          },
        },
      };
    }),

  clearTasks: () => set({ tasks: {} }),
}));

/** Deduplicate events by event_id to prevent re-processing. Returns true if the event was already seen. */
export function markEventSeen(eventId: string): boolean {
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  // Prevent unbounded growth
  if (processedEvents.size > MAX_PROCESSED_EVENTS) {
    const entries = Array.from(processedEvents);
    entries.slice(0, entries.length - MAX_PROCESSED_EVENTS).forEach((id) => processedEvents.delete(id));
  }
  return false;
}

/** Derive a sorted task list from the store. */
export function selectTaskList(tasks: Record<string, TaskEntry>): TaskEntry[] {
  return Object.values(tasks).sort((a, b) => b.updatedAt - a.updatedAt);
}
