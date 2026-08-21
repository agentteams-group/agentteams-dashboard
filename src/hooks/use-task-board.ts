'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useEffect } from 'react';
import { apiUrl } from '@/lib/api-base';
import { useTaskStore, type TaskEntry } from '@/lib/task-store';

/** Mirrors the server's TaskBoardTask / TaskBoardProject / PlanItem. */
export interface PlanItem {
  marker: string;
  taskId?: string;
  owner?: string;
  text: string;
  inProgress: boolean;
  done: boolean;
  blocked: boolean;
}

export interface PhasePlan {
  heading: string;
  items: PlanItem[];
}

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'revision'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'unknown';

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'unknown';

export type TaskOutcome = 'SUCCESS' | 'SUCCESS_WITH_NOTES' | 'REVISION_NEEDED' | 'BLOCKED' | null;

export interface BoardTask {
  runId: string;
  title: string;
  status: TaskStatus;
  assignedTo: string;
  projectId?: string;
  roomId: string;
  dependsOn: string[];
  createdAt: number;
  completedAt?: number;
  outcome: TaskOutcome;
  spec?: string;
  source: string;
}

export interface BoardProject {
  runId: string;
  name: string;
  status: ProjectStatus;
  roomId: string;
  leader?: string;
  workers: string[];
  phases: PhasePlan[];
  createdAt: number;
  completedAt?: number;
  source: string;
}

export interface TeamTasksResponse {
  tasks: BoardTask[];
  projects: BoardProject[];
  scannedKeys: string[];
  matchedPrefixes: string[];
  bucket: string | null;
  scannedAt: number;
  error?: string;
}

const QUERY_KEY = ['team-tasks'] as const;

/**
 * Hook: load the task board data from `/api/agentteams/team-tasks/`.
 *
 * The server reads `shared/tasks/{id}/meta.json`,
 * `shared/projects/{id}/{meta.json,plan.md}`, and
 * `agents/{worker}/task-history.json` out of the configured MinIO bucket
 * and returns a normalized list of BoardTask + BoardProject records.
 *
 * While a real task is missing, the response can be empty (no real data
 * has been synced to MinIO yet). We fall back to in-memory Matrix
 * workflow events collected by `useTaskStore` so the board still shows
 * recent activity.
 */
export function useTaskBoard(options: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery<TeamTasksResponse>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(apiUrl('/api/agentteams/team-tasks/'), { cache: 'no-store' });
      if (!res.ok) {
        return {
          tasks: [],
          projects: [],
          scannedKeys: [],
          matchedPrefixes: [],
          bucket: null,
          scannedAt: Date.now(),
          error: `HTTP ${res.status}`,
        };
      }
      return (await res.json()) as TeamTasksResponse;
    },
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? 8000,
    retry: 1,
    placeholderData: (prev) => prev,
    throwOnError: false,
  });
}

/** Convenience: invalidates the task board query. */
export function useInvalidateTaskBoard() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: QUERY_KEY });
}

/** One-time dev logging for the task board scan. */
export function useLogTaskBoardScan(
  matched: string[],
  scanned: string[],
  bucket: string | null,
  error?: string,
): void {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (error) {
      console.warn('[useTaskBoard] error:', error);
      return;
    }
    if (matched.length > 0 || scanned.length > 0) {
      console.warn('[useTaskBoard] debug', { bucket, matched, scannedCount: scanned.length });
    }
  }, [matched, scanned, bucket, error]);
}

/** Convert a BoardTask to the legacy TaskEntry shape used by the live store. */
export function boardTaskToEntry(task: BoardTask): TaskEntry {
  return {
    runId: task.runId,
    title: task.title,
    status: task.status,
    roomId: task.roomId,
    senderMatrixUserId: task.assignedTo,
    subagents: [],
    steps: [],
    createdAt: task.createdAt,
    updatedAt: task.completedAt ?? task.createdAt,
  };
}

/**
 * Combined view: persistent (MinIO) board data + live Matrix workflow
 * events. Persistent data wins on runId conflict because it represents
 * the controller's canonical state.
 */
export function useMergedTaskBoard(options: {
  refetchInterval?: number;
  enabled?: boolean;
} = {}) {
  const board = useTaskBoard(options);
  const live = useTaskStore((s) => s.tasks);

  const merged = useMemo(() => {
    const byId = new Map<string, BoardTask>();
    // Persistent board first
    for (const t of board.data?.tasks ?? []) byId.set(t.runId, t);
    // Live Matrix workflow events fill in any runIds the board doesn't
    // know about, and refresh the updatedAt timestamp so live ones sort
    // first.
    for (const [, e] of Object.entries(live)) {
      const existing = byId.get(e.runId);
      const liveTask: BoardTask = {
        runId: e.runId,
        title: e.title,
        status: e.status as TaskStatus,
        assignedTo: e.senderMatrixUserId,
        roomId: e.roomId,
        projectId: existing?.projectId,
        dependsOn: existing?.dependsOn ?? [],
        createdAt: e.createdAt,
        completedAt: existing?.completedAt,
        outcome: existing?.outcome ?? null,
        spec: existing?.spec,
        source: 'matrix-live',
      };
      byId.set(e.runId, existing ? { ...existing, status: liveTask.status } : liveTask);
    }
    return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [board.data, live]);

  return useMemo(
    () => ({
      tasks: merged,
      projects: board.data?.projects ?? [],
      scannedKeys: board.data?.scannedKeys ?? [],
      matchedPrefixes: board.data?.matchedPrefixes ?? [],
      bucket: board.data?.bucket ?? null,
      scannedAt: board.data?.scannedAt ?? 0,
      error: board.data?.error,
      isLoading: board.isLoading,
      refetch: () => {
        board.refetch();
      },
    }),
    [merged, board],
  );
}
