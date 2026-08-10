import { create } from 'zustand';
import type { WorkflowItem } from '@/lib/a2ui/workflow';

export interface TaskEntry {
  runId: string;
  title: string;
  status: string;
  roomId: string;
  /** Matrix user id (@alice:server) who sent the workflow message — usually the Manager. */
  senderMatrixUserId: string;
  /** epoch ms from Matrix origin_server_ts at first ingest. */
  createdAt: number;
  subagents: WorkflowItem[];
  steps: WorkflowItem[];
  updatedAt: number;
}

interface TaskStore {
  tasks: Record<string, TaskEntry>;
  upsertTask: (
    task: Omit<TaskEntry, 'updatedAt' | 'createdAt'> & { createdAt?: number },
    timestamp?: number,
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

      const now = timestamp ?? Date.now();
      return {
        tasks: {
          ...state.tasks,
          [task.runId]: {
            ...task,
            createdAt: existing?.createdAt ?? task.createdAt ?? now,
            updatedAt: now,
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

/** Derive a sorted task list from the store (most recently updated first). */
export function selectTaskList(tasks: Record<string, TaskEntry>): TaskEntry[] {
  return Object.values(tasks).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Filter tasks sent by a specific Matrix user (e.g. a particular Manager). */
export function selectTasksBySender(
  tasks: Record<string, TaskEntry>,
  matrixUserId: string,
): TaskEntry[] {
  if (!matrixUserId) return [];
  return selectTaskList(tasks).filter((t) => t.senderMatrixUserId === matrixUserId);
}

/** Filter tasks originated from any of the given Matrix rooms. */
export function selectTasksByRooms(
  tasks: Record<string, TaskEntry>,
  roomIds: Set<string>,
): TaskEntry[] {
  if (roomIds.size === 0) return [];
  return selectTaskList(tasks).filter((t) => roomIds.has(t.roomId));
}
