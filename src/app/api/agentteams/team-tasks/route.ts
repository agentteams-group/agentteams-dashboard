// GET /api/agentteams/team-tasks
//
// Aggregate task data persisted by AgentTeams workers/managers into a
// normalized list of task entries. The server side is the only place that
// knows the configured MinIO bucket (it comes from
// AGENTTEAMS_FS_BUCKET / AGENTTEAMS_MINIO_BUCKET env vars), so probing
// candidate prefixes must happen here.
//
// Storage layout (per docs/k8s-native-agent-orch.md and the manager's
// task-management skills):
//
//   shared/tasks/{task-id}/
//     meta.json     <-- canonical task metadata (title/status/runId/...)
//     spec.md
//     result.md
//     plan.md
//     base/         <-- task workspace files
//     progress/     <-- progress log
//
//   shared/projects/{project-id}/
//     meta.json
//     plan.md
//
//   agents/{worker-name}/task-history.json   <-- per-worker task history array
//
// Team-scoped data is not stored under a `team/` prefix; teams are a
// communication topology rather than a storage root. Cross-team task
// records still land in `shared/tasks/`.
//
// We probe in priority order:
//   1) shared/tasks/        — primary (each task is its own directory)
//   2) shared/projects/     — project-level task metadata
//   3) agents/*/task-history.json — per-worker task history
//   4) shared/team-tasks/   — older aggregated layout
//   5) team/                — legacy candidate (some controllers still use)
//   6) team-tasks/          — legacy candidate
//
// Each per-task meta.json is a single object (not an array). The
// per-worker task-history.json IS an array. Both shapes are accepted via
// unwrapFileContent().
//
// Response:
//   {
//     tasks: TaskEntry[],
//     scannedKeys: string[],
//     matchedPrefixes: string[],
//     bucket: string,
//     scannedAt: epoch ms
//   }
//
// Empty arrays are returned on any error (network, missing bucket, etc.)
// so the dashboard degrades gracefully and shows a diagnostic banner.

import { NextResponse } from 'next/server';
import type { Client } from 'minio';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';

export const dynamic = 'force-dynamic';

interface RawTask {
  runId?: string;
  title?: string;
  name?: string;
  status?: string;
  roomId?: string;
  senderMatrixUserId?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  subagents?: unknown;
  steps?: unknown;
  [k: string]: unknown;
}

export interface TaskEntry {
  runId: string;
  title: string;
  status: string;
  roomId: string;
  senderMatrixUserId: string;
  createdAt: number;
  updatedAt: number;
  subagents: RawTask[];
  steps: RawTask[];
  /** Source prefix this task came from (e.g. "shared/tasks/abc12"). */
  source: string;
}

interface ScannedSource {
  /** Display name for matchedPrefixes list. */
  prefix: string;
  /** Type of source so the response can distinguish them. */
  kind: 'shared-tasks-dir' | 'shared-projects-dir' | 'worker-history' | 'legacy-aggregated';
  /** Object keys actually read. */
  scannedKeys: string[];
}

const SHARED_TASKS_PREFIX = 'shared/tasks/';
const SHARED_PROJECTS_PREFIX = 'shared/projects/';
const AGENTS_PREFIX = 'agents/';
const WORKER_HISTORY_FILENAME = 'task-history.json';

const LEGACY_PREFIXES = [
  'shared/team-tasks/',
  'shared/teams/',
  'team/',
  'teams/',
  'team-tasks/',
] as const;

const LEGACY_FILE_NAMES = ['tasks.json', 'task.json'] as const;

function toEpochMs(v: string | number | undefined, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : fallback;
  }
  return fallback;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Test-only export. Normalize a raw task record into a TaskEntry. */
export const __test__ = {
  normalizeTask,
  unwrapFileContent,
};

function normalizeTask(
  raw: RawTask,
  now: number,
  source: string,
): TaskEntry | null {
  if (!isObject(raw)) return null;
  // runId may live under several keys depending on the writer.
  const runId =
    typeof raw.runId === 'string'
      ? raw.runId
      : typeof raw.run_id === 'string'
        ? raw.run_id
        : typeof raw.id === 'string'
          ? raw.id
          : typeof raw.taskId === 'string'
            ? raw.taskId
            : null;
  if (!runId) return null;

  const created = toEpochMs(raw.createdAt, now);
  const updated = toEpochMs(raw.updatedAt, created);
  return {
    runId,
    title:
      (typeof raw.title === 'string' && raw.title) ||
      (typeof raw.name === 'string' && raw.name) ||
      '未命名任务',
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    roomId: typeof raw.roomId === 'string' ? raw.roomId : '',
    senderMatrixUserId:
      typeof raw.senderMatrixUserId === 'string' ? raw.senderMatrixUserId : '',
    createdAt: created,
    updatedAt: updated,
    subagents: Array.isArray(raw.subagents) ? (raw.subagents as RawTask[]) : [],
    steps: Array.isArray(raw.steps) ? (raw.steps as RawTask[]) : [],
    source,
  };
}

function unwrapFileContent(parsed: unknown): RawTask[] {
  if (Array.isArray(parsed)) return parsed as RawTask[];
  if (isObject(parsed) && Array.isArray(parsed.tasks)) {
    return parsed.tasks as RawTask[];
  }
  if (isObject(parsed) && typeof parsed.runId === 'string') {
    return [parsed as RawTask];
  }
  // Some writers stash the id as `taskId` or `id` — fall through to the
  // single-object path so the caller can decide.
  if (isObject(parsed)) {
    const looksLikeTask =
      typeof parsed.title === 'string' ||
      typeof parsed.name === 'string' ||
      typeof parsed.runId === 'string' ||
      typeof parsed.run_id === 'string' ||
      typeof parsed.status === 'string';
    if (looksLikeTask) return [parsed as RawTask];
  }
  return [];
}

interface ListResult {
  prefixes: string[];
  files: string[];
}

async function listAtPrefix(
  client: Client,
  bucket: string,
  prefix: string,
): Promise<ListResult> {
  return new Promise((resolve, reject) => {
    const prefixes: string[] = [];
    const files: string[] = [];
    const stream = client.listObjects(bucket, prefix, false);
    stream.on('data', (obj: Record<string, unknown>) => {
      if (typeof obj.prefix === 'string') {
        prefixes.push(obj.prefix);
      } else if (typeof obj.name === 'string') {
        files.push(obj.name);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ prefixes, files }));
  });
}

async function getObjectText(
  client: Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const stream = await client.getObject(bucket, key);
    return new Promise<string | null>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
      stream.on('close', () =>
        resolve(Buffer.concat(chunks).toString('utf-8')),
      );
    });
  } catch {
    return null;
  }
}

/**
 * Source 1 (primary): `shared/tasks/{taskId}/meta.json` for every subdir
 * under `shared/tasks/`. Each task is its own directory.
 */
async function collectSharedTasks(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ tasks: TaskEntry[]; scannedKeys: string[] }> {
  const result = { tasks: [] as TaskEntry[], scannedKeys: [] as string[] };
  let list: ListResult;
  try {
    list = await listAtPrefix(client, bucket, SHARED_TASKS_PREFIX);
  } catch {
    return result;
  }
  // listObjects(bucket, prefix, false) returns one entry per non-recursive
  // child: prefixes (sub-directories) and files. We expect only prefixes
  // here; bare .json files at this level are rare but still handled.
  for (const subPrefix of list.prefixes) {
    const metaKey = `${subPrefix}meta.json`;
    const text = await getObjectText(client, bucket, metaKey);
    if (!text) continue;
    result.scannedKeys.push(metaKey);
    try {
      const parsed = JSON.parse(text);
      for (const t of unwrapFileContent(parsed)) {
        const entry = normalizeTask(t, now, subPrefix.replace(/\/$/, ''));
        if (entry) result.tasks.push(entry);
      }
    } catch {
      // ignore parse errors
    }
  }
  return result;
}

/**
 * Source 2: `shared/projects/{projectId}/meta.json` may embed tasks under
 * a `tasks` key. Projects can outlive individual tasks and act as a
 * secondary record.
 */
async function collectSharedProjects(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ tasks: TaskEntry[]; scannedKeys: string[] }> {
  const result = { tasks: [] as TaskEntry[], scannedKeys: [] as string[] };
  let list: ListResult;
  try {
    list = await listAtPrefix(client, bucket, SHARED_PROJECTS_PREFIX);
  } catch {
    return result;
  }
  for (const subPrefix of list.prefixes) {
    const metaKey = `${subPrefix}meta.json`;
    const text = await getObjectText(client, bucket, metaKey);
    if (!text) continue;
    result.scannedKeys.push(metaKey);
    try {
      const parsed = JSON.parse(text);
      for (const t of unwrapFileContent(parsed)) {
        const entry = normalizeTask(t, now, subPrefix.replace(/\/$/, ''));
        if (entry) result.tasks.push(entry);
      }
    } catch {
      // ignore parse errors
    }
  }
  return result;
}

/**
 * Source 3: each worker's `task-history.json` is a flat array of task
 * objects keyed by task id.
 */
async function collectWorkerHistories(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ tasks: TaskEntry[]; scannedKeys: string[] }> {
  const result = { tasks: [] as TaskEntry[], scannedKeys: [] as string[] };
  let list: ListResult;
  try {
    list = await listAtPrefix(client, bucket, AGENTS_PREFIX);
  } catch {
    return result;
  }
  await Promise.all(
    list.prefixes.map(async (agentPrefix) => {
      const key = `${agentPrefix}${WORKER_HISTORY_FILENAME}`;
      const text = await getObjectText(client, bucket, key);
      if (!text) return;
      result.scannedKeys.push(key);
      try {
        const parsed = JSON.parse(text);
        for (const t of unwrapFileContent(parsed)) {
          const entry = normalizeTask(t, now, agentPrefix.replace(/\/$/, ''));
          if (entry) result.tasks.push(entry);
        }
      } catch {
        // ignore parse errors
      }
    }),
  );
  return result;
}

/**
 * Source 4-6 (legacy): aggregated files like `team/{name}/tasks.json` or
 * `shared/team-tasks/{id}.json`. Kept for backward compatibility with
 * older controller / agent builds. Lower priority than primary sources.
 */
async function collectLegacyAggregates(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ tasks: TaskEntry[]; scannedKeys: string[] }> {
  const result = { tasks: [] as TaskEntry[], scannedKeys: [] as string[] };
  for (const prefix of LEGACY_PREFIXES) {
    let list: ListResult;
    try {
      list = await listAtPrefix(client, bucket, prefix);
    } catch {
      continue;
    }
    if (list.prefixes.length === 0 && list.files.length === 0) continue;

    // Layout A: prefix/{team}/tasks.json
    for (const subPrefix of list.prefixes) {
      for (const filename of LEGACY_FILE_NAMES) {
        const key = `${subPrefix}${filename}`;
        const text = await getObjectText(client, bucket, key);
        if (text) {
          result.scannedKeys.push(key);
          try {
            const parsed = JSON.parse(text);
            for (const t of unwrapFileContent(parsed)) {
              const entry = normalizeTask(t, now, subPrefix.replace(/\/$/, ''));
              if (entry) result.tasks.push(entry);
            }
          } catch {
            // ignore
          }
          break;
        }
      }
    }

    // Layout B: bare .json files directly under the prefix
    for (const fileKey of list.files) {
      if (!/\.json$/i.test(fileKey)) continue;
      const text = await getObjectText(client, bucket, fileKey);
      if (!text) continue;
      result.scannedKeys.push(fileKey);
      try {
        const parsed = JSON.parse(text);
        for (const t of unwrapFileContent(parsed)) {
          const entry = normalizeTask(t, now, prefix.replace(/\/$/, ''));
          if (entry) result.tasks.push(entry);
        }
      } catch {
        // ignore
      }
    }
  }
  return result;
}

export async function GET() {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json(
      {
        tasks: [],
        scannedKeys: [],
        matchedPrefixes: [],
        bucket: null,
        scannedAt: Date.now(),
        error: 'No bucket configured (AGENTTEAMS_FS_BUCKET or AGENTTEAMS_MINIO_BUCKET)',
      },
      { status: 200 },
    );
  }

  let client: Client;
  try {
    client = createMinioClient();
  } catch (err: unknown) {
    return NextResponse.json(
      {
        tasks: [],
        scannedKeys: [],
        matchedPrefixes: [],
        bucket,
        scannedAt: Date.now(),
        error: err instanceof Error ? err.message : 'MinIO client init failed',
      },
      { status: 200 },
    );
  }

  const now = Date.now();
  const sources: ScannedSource[] = [];

  // 1. Primary: shared/tasks/{taskId}/meta.json
  const shared = await collectSharedTasks(client, bucket, now);
  if (shared.scannedKeys.length > 0) {
    sources.push({
      prefix: SHARED_TASKS_PREFIX,
      kind: 'shared-tasks-dir',
      scannedKeys: shared.scannedKeys,
    });
  }

  // 2. Secondary: shared/projects/{projectId}/meta.json
  const projects = await collectSharedProjects(client, bucket, now);
  if (projects.scannedKeys.length > 0) {
    sources.push({
      prefix: SHARED_PROJECTS_PREFIX,
      kind: 'shared-projects-dir',
      scannedKeys: projects.scannedKeys,
    });
  }

  // 3. Per-worker: agents/{workerName}/task-history.json
  const histories = await collectWorkerHistories(client, bucket, now);
  if (histories.scannedKeys.length > 0) {
    sources.push({
      prefix: AGENTS_PREFIX,
      kind: 'worker-history',
      scannedKeys: histories.scannedKeys,
    });
  }

  // 4-6. Legacy layouts (team/, teams/, team-tasks/, shared/team-tasks/, shared/teams/)
  const legacy = await collectLegacyAggregates(client, bucket, now);
  if (legacy.scannedKeys.length > 0) {
    sources.push({
      prefix: 'legacy',
      kind: 'legacy-aggregated',
      scannedKeys: legacy.scannedKeys,
    });
  }

  // Merge all sources. Each task's runId is the natural key — later
  // sources can refine but we keep the first observed one to avoid
  // confusing users with fluctuating titles.
  const byRunId = new Map<string, TaskEntry>();
  for (const t of [...shared.tasks, ...projects.tasks, ...histories.tasks, ...legacy.tasks]) {
    const existing = byRunId.get(t.runId);
    if (!existing) {
      byRunId.set(t.runId, t);
    } else {
      // Keep the more recent updatedAt; if equal, prefer the higher-priority
      // source (shared.tasks > projects > histories > legacy).
      if (t.updatedAt > existing.updatedAt) {
        byRunId.set(t.runId, { ...t, subagents: t.subagents.length ? t.subagents : existing.subagents, steps: t.steps.length ? t.steps : existing.steps });
      }
    }
  }
  const tasks = Array.from(byRunId.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  return NextResponse.json({
    tasks,
    scannedKeys: sources.flatMap((s) => s.scannedKeys),
    matchedPrefixes: sources.map((s) => `${s.prefix} (${s.kind})`),
    bucket,
    scannedAt: now,
  });
}
