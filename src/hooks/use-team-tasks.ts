'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { StorageObject } from '@/lib/agentteams-api';
import type { TaskEntry } from '@/lib/task-store';

/**
 * Persisted task file format on MinIO. createdAt/updatedAt are stored as ISO
 * strings (or epoch ms) — the hook normalizes them to epoch ms.
 */
export interface PersistedTask {
  runId: string;
  title: string;
  status: string;
  roomId: string;
  senderMatrixUserId?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  subagents?: Array<{ id?: string; name?: string; title?: string; status?: string; [k: string]: unknown }>;
  steps?: Array<{ id?: string; name?: string; title?: string; status?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export const TEAM_TASKS_BUCKET = 'agentteams-storage';

/** Candidate prefixes to probe, in order of likelihood. */
export const TEAM_TASK_PREFIXES = ['team/', 'teams/', 'shared/teams/', 'shared/tasks/'] as const;

/** Candidate file names inside a team's directory (layout A: aggregated file). */
export const TEAM_TASK_FILES = ['tasks.json', 'task.json'] as const;

function toEpochMs(v: string | number | undefined, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : fallback;
  }
  return fallback;
}

function normalizeTask(p: PersistedTask, now: number): TaskEntry {
  const created = toEpochMs(p.createdAt, now);
  const updated = toEpochMs(p.updatedAt, created);
  return {
    runId: p.runId,
    title: p.title || '未命名任务',
    status: p.status || 'unknown',
    roomId: p.roomId,
    senderMatrixUserId: p.senderMatrixUserId || '',
    subagents: Array.isArray(p.subagents) ? p.subagents : [],
    steps: Array.isArray(p.steps) ? p.steps : [],
    createdAt: created,
    updatedAt: updated,
  };
}

/** Fetch a single object's raw text via the storage download API. */
async function fetchObjectText(bucket: string, key: string): Promise<string | null> {
  try {
    const url = agentteamsApi.downloadObjectUrl(bucket, key);
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface ScannedFile {
  prefix: string;
  key: string;
  size: number;
  lastModified?: string;
}

/**
 * Try to discover persisted task files. We probe each candidate prefix,
 * then for any matching directory we try the candidate filenames.
 */
async function scanTaskFiles(signal?: AbortSignal): Promise<{ rootPrefix: string; files: ScannedFile[] }[]> {
  const results: { rootPrefix: string; files: ScannedFile[] }[] = [];
  for (const prefix of TEAM_TASK_PREFIXES) {
    if (signal?.aborted) break;
    const list: StorageObject[] = await agentteamsApi.listObjects(TEAM_TASKS_BUCKET, prefix).catch(() => []);
    if (!Array.isArray(list) || list.length === 0) continue;

    const files: ScannedFile[] = [];
    const childPrefixes = list.filter((o) => o.isPrefix).map((o) => o.key);

    for (const subPrefix of childPrefixes) {
      if (signal?.aborted) break;
      // Layout A: prefix/{team}/tasks.json
      let resolved = false;
      for (const filename of TEAM_TASK_FILES) {
        const candidateKey = `${subPrefix}${filename}`;
        const text = await fetchObjectText(TEAM_TASKS_BUCKET, candidateKey);
        if (text) {
          files.push({ prefix, key: candidateKey, size: text.length });
          resolved = true;
          break;
        }
      }
      if (resolved) continue;

      // Layout B: prefix/{team}/task/{runId}.json (per-task files)
      const deeper = await agentteamsApi.listObjects(TEAM_TASKS_BUCKET, subPrefix).catch(() => []);
      for (const o of deeper ?? []) {
        if (o.isPrefix) continue;
        if (!/\.json$/i.test(o.key)) continue;
        files.push({ prefix, key: o.key, size: o.size, lastModified: o.lastModified });
      }
    }

    // Layout C: bare .json files directly under the prefix
    for (const o of list) {
      if (o.isPrefix) continue;
      if (!/\.json$/i.test(o.key)) continue;
      files.push({ prefix, key: o.key, size: o.size, lastModified: o.lastModified });
    }

    if (files.length > 0) {
      results.push({ rootPrefix: prefix, files });
    }
  }
  return results;
}

export interface TeamTasksResponse {
  /** Normalized tasks ready for TaskEntry consumers. */
  tasks: TaskEntry[];
  /** Scanned file keys (for debugging). */
  scannedKeys: string[];
  /** Root prefixes that returned at least one file. */
  matchedPrefixes: string[];
  /** When the scan last completed (epoch ms). */
  scannedAt: number;
}

async function fetchAllTeamTasks(signal?: AbortSignal): Promise<TeamTasksResponse> {
  const scan = await scanTaskFiles(signal);
  const tasks: TaskEntry[] = [];
  const scannedKeys: string[] = [];
  const matchedPrefixes: string[] = [];
  const now = Date.now();

  for (const { rootPrefix, files } of scan) {
    matchedPrefixes.push(rootPrefix);
    for (const f of files) {
      scannedKeys.push(f.key);
      if (signal?.aborted) break;
      const text = await fetchObjectText(TEAM_TASKS_BUCKET, f.key);
      if (!text) continue;

      // The file may be: a single task object, a top-level array, or a
      // { tasks: [...] } envelope — accept all three.
      let parsed: PersistedTask | PersistedTask[] | { tasks: PersistedTask[] };
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const list: PersistedTask[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { tasks?: PersistedTask[] }).tasks)
        ? (parsed as { tasks: PersistedTask[] }).tasks
        : [parsed as PersistedTask];
      for (const t of list) {
        if (!t || typeof t !== 'object' || !t.runId) continue;
        tasks.push(normalizeTask(t, now));
      }
    }
  }

  return { tasks, scannedKeys, matchedPrefixes, scannedAt: now };
}

/**
 * Hook: load persisted task data from MinIO bucket `agentteams-storage`.
 *
 * The task panel uses this to read the durable team task files written by
 * the controller/agent side. It complements `useTaskStore` (which captures
 * live `agentteams.workflow` Matrix events). Persisted data wins on conflict.
 */
export function useTeamTasks(options: { enabled?: boolean; refetchInterval?: number } = {}) {
  const { enabled = true, refetchInterval = 5000 } = options;
  return useQuery<TeamTasksResponse>({
    queryKey: ['team-tasks', TEAM_TASKS_BUCKET],
    queryFn: ({ signal }) => fetchAllTeamTasks(signal),
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
  return () => qc.invalidateQueries({ queryKey: ['team-tasks', TEAM_TASKS_BUCKET] });
}

/** Log a one-time line in dev to help diagnose missing files. */
export function useLogTeamTaskScan(prefixes: string[], keys: string[]): void {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && (prefixes.length > 0 || keys.length > 0)) {
      console.debug('[useTeamTasks] matched prefixes:', prefixes, 'keys:', keys);
    }
  }, [prefixes, keys]);
}
