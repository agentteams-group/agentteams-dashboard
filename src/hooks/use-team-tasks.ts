'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useEffect } from 'react';
import { apiUrl } from '@/lib/api-base';
import type { TaskEntry } from '@/lib/task-store';

/**
 * Persisted task format returned by GET /api/agentteams/team-tasks. Mirrors
 * TaskEntry but adds a `source` field describing where the record came from
 * (e.g. "shared/tasks/abc12" or "agents/tech-verify") so the task panel can
 * surface provenance when the same task id is observed from multiple sources.
 */
export interface PersistedTaskEntry extends TaskEntry {
  /** MinIO prefix the record was loaded from (e.g. "shared/tasks/abc12"). */
  source?: string;
  /** Owning worker (only populated for worker-history sourced tasks). */
  workerName?: string;
  bucket?: string | null;
  scannedAt?: number;
}

interface TeamTasksResponse {
  tasks: PersistedTaskEntry[];
  scannedKeys: string[];
  matchedPrefixes: string[];
  bucket: string | null;
  scannedAt: number;
  error?: string;
}

const QUERY_KEY = ['team-tasks'] as const;

/**
 * Hook: load persisted task data from the server-side aggregator at
 * `/api/agentteams/team-tasks`. The server reads the configured MinIO
 * bucket from env and probes the real storage layout (each task is its own
 * directory under `shared/tasks/{task-id}/` with a `meta.json`; projects
 * live under `shared/projects/`; per-worker history under
 * `agents/{worker}/task-history.json`).
 *
 * The response includes:
 *  - `tasks`: normalized TaskEntry[] ready for the task panel
 *  - `scannedKeys`: which MinIO keys were parsed (for diagnostics)
 *  - `matchedPrefixes`: which prefixes actually had files
 *  - `error`: bucket-not-configured or MinIO-unreachable, if any
 *
 * Persisted data wins on conflict with the live Matrix workflow stream
 * because it represents the controller's canonical state.
 */
export function useTeamTasks(options: { enabled?: boolean; refetchInterval?: number } = {}) {
  const { enabled = true, refetchInterval = 8000 } = options;
  return useQuery<TeamTasksResponse>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(apiUrl('/api/agentteams/team-tasks'), { cache: 'no-store' });
      if (!res.ok) {
        return {
          tasks: [],
          scannedKeys: [],
          matchedPrefixes: [],
          bucket: null,
          scannedAt: Date.now(),
          error: `HTTP ${res.status}`,
        };
      }
      return (await res.json()) as TeamTasksResponse;
    },
    enabled,
    refetchInterval,
    retry: 1,
    placeholderData: (prev) => prev,
    throwOnError: false,
  });
}

/**
 * Merge persisted team tasks with live Matrix workflow tasks.
 *
 * Persisted (MinIO) data wins on conflict because it represents the
 * controller's canonical state. Live tasks not yet persisted are appended.
 * Final list is sorted by updatedAt desc.
 */
export function mergeTasks(persisted: TaskEntry[], live: TaskEntry[]): TaskEntry[] {
  const map = new Map<string, TaskEntry>();
  for (const t of live) map.set(t.runId, t);
  for (const t of persisted) map.set(t.runId, t);
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Invalidate the team-tasks query (e.g. after a known controller write). */
export function useInvalidateTeamTasks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: QUERY_KEY });
}

/** Log a one-time line in dev to help diagnose missing files. */
export function useLogTeamTaskScan(prefixes: string[], keys: string[], error?: string): void {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      if (error) {
        console.warn('[useTeamTasks] error:', error);
        return;
      }
      if (prefixes.length > 0 || keys.length > 0) {
        console.debug('[useTeamTasks] matched prefixes:', prefixes, 'keys:', keys);
      }
    }
  }, [prefixes, keys, error]);
}

/** Convenience hook returning just the normalized task list and metadata. */
export function useTeamTaskList(options: { refetchInterval?: number; enabled?: boolean } = {}) {
  const q = useTeamTasks(options);
  return useMemo(
    () => ({
      tasks: (q.data?.tasks ?? []) as TaskEntry[],
      scannedKeys: q.data?.scannedKeys ?? [],
      matchedPrefixes: q.data?.matchedPrefixes ?? [],
      bucket: q.data?.bucket ?? null,
      scannedAt: q.data?.scannedAt ?? 0,
      error: q.data?.error,
      isLoading: q.isLoading,
      refetch: () => {
        q.refetch();
      },
    }),
    [q.data, q.isLoading, q],
  );
}
