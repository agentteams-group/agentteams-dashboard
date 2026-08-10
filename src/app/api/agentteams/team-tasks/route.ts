// GET /api/agentteams/team-tasks
//
// Aggregate task data persisted by AgentTeams workers/managers into a
// normalized list of task entries. The server side is the only place that
// knows the configured MinIO bucket (it comes from
// AGENTTEAMS_FS_BUCKET / AGENTTEAMS_MINIO_BUCKET env vars), so probing
// candidate prefixes must happen here.
//
// IMPORTANT — primary data source is Matrix room history, not MinIO.
// As confirmed by the operator:
//
//   "任务协作数据实际落在 teams/tech-commercialization/shared/knowledge/ 下,
//    以 snspd-tech-to-scenario-20260809-* 形式存在；项目元数据则在
//    teams/tech-commercialization/shared/projects/。不过当前这些目录在
//    MinIO 侧只有占位目录，具体文件是否已同步到本地镜像还需要 file-sync
//    后再读。"
//
// Concretely: Leader and Workers report task status in Matrix rooms
// (`m.room.message` payloads with `agentteams.workflow` and
// `org.agentteams.status` keys). Dashboard's Matrix sync already
// extracts these into the live task store; this endpoint is a *fallback*
// that scans MinIO for any persisted file copies.
//
// MinIO storage layout (team-scoped, per the actual file-sync source):
//
//   teams/{team-name}/shared/knowledge/{name}.md   <- team task notes
//   teams/{team-name}/shared/projects/{name}/      <- project directory
//     meta.json                                    <- project metadata
//     plan.md
//
//   agents/{worker-name}/task-history.json        <- per-worker flat array
//
// We probe in priority order:
//   1) teams/{team}/shared/knowledge/   — primary (team-scoped task notes)
//   2) teams/{team}/shared/projects/     — project metadata
//   3) agents/*/task-history.json       — per-worker history
//   4) shared/tasks/, shared/projects/   — older (un-scoped) layout
//   5) team/, teams/, team-tasks/        — legacy fallbacks
//
// Per-task meta.json may be: single object, top-level array, or
// { tasks: [...] } envelope. unwrapFileContent() handles all three.
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
  /** MinIO prefix this task came from (e.g. "teams/tech-co/shared/projects/snspd"). */
  source: string;
}

interface ScannedSource {
  /** Display name for matchedPrefixes list. */
  prefix: string;
  /** Type of source so the response can distinguish them. */
  kind:
    | 'team-knowledge'
    | 'team-projects'
    | 'worker-history'
    | 'unscoped-shared'
    | 'legacy-aggregated';
  /** Object keys actually read. */
  scannedKeys: string[];
}

const TEAMS_PREFIX = 'teams/';
const AGENTS_PREFIX = 'agents/';
const WORKER_HISTORY_FILENAME = 'task-history.json';

const PRIMARY_PROBES: ReadonlyArray<{ prefix: string; kind: ScannedSource['kind'] }> = [
  // Per the operator-confirmed layout, the team-scoped knowledge/ dir
  // holds the bulk of the cross-room task notes. We don't know the team
  // name ahead of time, so we list `teams/` first and walk every team
  // subdir for its `shared/knowledge/` and `shared/projects/` children.
  { prefix: 'teams/', kind: 'team-knowledge' },
  { prefix: 'agents/', kind: 'worker-history' },
];

const LEGACY_PROBES: ReadonlyArray<{ prefix: string; kind: ScannedSource['kind'] }> = [
  { prefix: 'shared/tasks/', kind: 'unscoped-shared' },
  { prefix: 'shared/projects/', kind: 'unscoped-shared' },
  { prefix: 'shared/teams/', kind: 'legacy-aggregated' },
  { prefix: 'shared/team-tasks/', kind: 'legacy-aggregated' },
  { prefix: 'team/', kind: 'legacy-aggregated' },
  { prefix: 'teams/', kind: 'legacy-aggregated' },
  { prefix: 'team-tasks/', kind: 'legacy-aggregated' },
];

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
 * Probe a team-scoped path: list every entry under
 * `teams/{team}/{subdir}/` and parse any .json files as task metadata.
 * .md files are also surfaced for the diagnostic banner but contribute
 * no task records (we don't try to extract structured data from prose).
 */
async function collectTeamScoped(
  client: Client,
  bucket: string,
  teamPrefix: string, // e.g. "teams/tech-co/"
  subdir: 'knowledge' | 'projects',
  now: number,
): Promise<{ tasks: TaskEntry[]; scannedKeys: string[] }> {
  const result = { tasks: [] as TaskEntry[], scannedKeys: [] as string[] };
  const list = await listAtPrefix(client, bucket, `${teamPrefix}shared/${subdir}/`).catch(() => null);
  if (!list) return result;

  // Layout A (knowledge): bare .md/.json files directly under shared/knowledge/
  for (const fileKey of list.files) {
    if (!/\.(json|md)$/i.test(fileKey)) continue;
    result.scannedKeys.push(fileKey);
    if (!/\.json$/i.test(fileKey)) continue; // .md contributes no task records
    const text = await getObjectText(client, bucket, fileKey);
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      const source = fileKey.replace(/\.json$/, '');
      for (const t of unwrapFileContent(parsed)) {
        const entry = normalizeTask(t, now, source);
        if (entry) result.tasks.push(entry);
      }
    } catch {
      // ignore
    }
  }

  // Layout B (projects): sub-directories each containing meta.json + plan.md
  for (const projectPrefix of list.prefixes) {
    const metaKey = `${projectPrefix}meta.json`;
    const text = await getObjectText(client, bucket, metaKey);
    if (!text) continue;
    result.scannedKeys.push(metaKey);
    try {
      const parsed = JSON.parse(text);
      const source = projectPrefix.replace(/\/$/, '');
      for (const t of unwrapFileContent(parsed)) {
        const entry = normalizeTask(t, now, source);
        if (entry) result.tasks.push(entry);
      }
    } catch {
      // ignore
    }
  }
  return result;
}

/**
 * Walk every team under `teams/` and collect both `shared/knowledge/`
 * and `shared/projects/`. Returns merged results across all teams.
 */
async function collectAllTeams(
  client: Client,
  bucket: string,
  now: number,
): Promise<{
  tasks: TaskEntry[];
  scannedKeys: string[];
  matched: { prefix: string; kind: ScannedSource['kind'] }[];
}> {
  const result = {
    tasks: [] as TaskEntry[],
    scannedKeys: [] as string[],
    matched: [] as { prefix: string; kind: ScannedSource['kind'] }[],
  };
  let list: ListResult;
  try {
    list = await listAtPrefix(client, bucket, TEAMS_PREFIX);
  } catch {
    return result;
  }

  // Each entry is either a sub-team directory (isPrefix) or a bare file
  // (unlikely at the teams/ root, but possible). We only care about
  // team directories.
  for (const teamPrefix of list.prefixes) {
    const knowledge = await collectTeamScoped(
      client,
      bucket,
      teamPrefix,
      'knowledge',
      now,
    );
    if (knowledge.scannedKeys.length > 0) {
      result.scannedKeys.push(...knowledge.scannedKeys);
      result.tasks.push(...knowledge.tasks);
      result.matched.push({
        prefix: `${teamPrefix}shared/knowledge/`,
        kind: 'team-knowledge',
      });
    }
    const projects = await collectTeamScoped(
      client,
      bucket,
      teamPrefix,
      'projects',
      now,
    );
    if (projects.scannedKeys.length > 0) {
      result.scannedKeys.push(...projects.scannedKeys);
      result.tasks.push(...projects.tasks);
      result.matched.push({
        prefix: `${teamPrefix}shared/projects/`,
        kind: 'team-projects',
      });
    }
  }
  return result;
}

/**
 * Each worker's `task-history.json` is a flat array of task objects.
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
        const source = agentPrefix.replace(/\/$/, '');
        for (const t of unwrapFileContent(parsed)) {
          const entry = normalizeTask(t, now, source);
          if (entry) result.tasks.push(entry);
        }
      } catch {
        // ignore
      }
    }),
  );
  return result;
}

/**
 * Legacy aggregated layouts: `team/{name}/tasks.json` or bare .json
 * files under team/, teams/, shared/team-tasks/, etc.
 */
async function collectLegacyAggregates(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ tasks: TaskEntry[]; scannedKeys: string[] }> {
  const result = { tasks: [] as TaskEntry[], scannedKeys: [] as string[] };
  for (const probe of LEGACY_PROBES) {
    if (probe.kind === 'team-knowledge') continue; // handled by collectAllTeams
    if (probe.kind === 'worker-history') continue; // handled by collectWorkerHistories
    let list: ListResult;
    try {
      list = await listAtPrefix(client, bucket, probe.prefix);
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
            const source = subPrefix.replace(/\/$/, '');
            for (const t of unwrapFileContent(parsed)) {
              const entry = normalizeTask(t, now, source);
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
        const source = probe.prefix.replace(/\/$/, '');
        for (const t of unwrapFileContent(parsed)) {
          const entry = normalizeTask(t, now, source);
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

  // 1. Primary: team-scoped shared/knowledge/ and shared/projects/ for
  //    every team. Walks teams/ then descends into each team's shared/.
  const teams = await collectAllTeams(client, bucket, now);

  // 2. Per-worker task history.
  const histories = await collectWorkerHistories(client, bucket, now);

  // 3. Legacy fallbacks (best-effort, lower priority).
  const legacy = await collectLegacyAggregates(client, bucket, now);

  // Merge by runId. Primary sources (team/worker) win; legacy is only
  // used to fill gaps. Newer updatedAt overrides older.
  const byRunId = new Map<string, TaskEntry>();
  const order = [...teams.tasks, ...histories.tasks, ...legacy.tasks];
  for (const t of order) {
    const existing = byRunId.get(t.runId);
    if (!existing) {
      byRunId.set(t.runId, t);
    } else if (t.updatedAt > existing.updatedAt) {
      byRunId.set(t.runId, {
        ...t,
        subagents: t.subagents.length ? t.subagents : existing.subagents,
        steps: t.steps.length ? t.steps : existing.steps,
      });
    }
  }
  const tasks = Array.from(byRunId.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  const matchedPrefixes: string[] = [];
  for (const m of teams.matched) {
    matchedPrefixes.push(`${m.prefix} (${m.kind})`);
  }
  if (histories.scannedKeys.length > 0) {
    matchedPrefixes.push('agents/ (worker-history)');
  }
  if (legacy.scannedKeys.length > 0) {
    matchedPrefixes.push('legacy (legacy-aggregated)');
  }

  return NextResponse.json({
    tasks,
    scannedKeys: [
      ...teams.scannedKeys,
      ...histories.scannedKeys,
      ...legacy.scannedKeys,
    ],
    matchedPrefixes,
    bucket,
    scannedAt: now,
  });
}

/** Test-only export. */
export const __test__ = {
  normalizeTask,
  unwrapFileContent,
};
