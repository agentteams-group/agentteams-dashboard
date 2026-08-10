// GET /api/agentteams/team-tasks
//
// Aggregate task and project data persisted by AgentTeams workers / managers
// into a normalized list of entries. Scoped to the configured MinIO bucket
// (AGENTTEAMS_FS_BUCKET / AGENTTEAMS_MINIO_BUCKET). No Matrix traffic —
// this endpoint intentionally only reads from MinIO so callers can populate
// a task board without paying for /sync.
//
// Storage layout (per the AgentTeams upstream task-management /
// project-management skills, see manager/agent/skills/{task,project}-management
// in https://github.com/agentscope-ai/AgentTeams):
//
//   shared/tasks/{task-id}/
//     meta.json     { task_id, task_title, assigned_to, room_id,
//                     project_id, status, depends_on, assigned_at,
//                     completed_at, ... }
//     spec.md       human-readable spec written by the manager
//     plan.md       worker-written execution plan
//     result.md     worker-written final report; first non-empty line
//                     after `## Outcome` is one of:
//                       SUCCESS | SUCCESS_WITH_NOTES |
//                       REVISION_NEEDED | BLOCKED
//
//   shared/projects/{project-id}/
//     meta.json     { project_id, project_name, status, workers[],
//                     leader, project_room_id, created_at, ... }
//     plan.md       project-wide plan with sections `## Phase N: <name>`
//                     and lines like `- [ ] task-...  <title>  (owner: alice)`
//                     whose bracket prefix tracks phase/task progress.
//
//   agents/{worker-name}/task-history.json   per-worker flat array of
//     finished task records (backup/audit trail).
//
// We probe in priority order, each task contributing independently to the
// final list:
//   1) shared/tasks/         — per-task directory (meta.json + plan.md
//                              + result.md when present)
//   2) shared/projects/      — per-project directory (meta.json + plan.md)
//   3) agents/*/task-history.json — per-worker audit log
//
// Empty arrays are returned on any error (network, missing bucket, etc.)
// so the dashboard degrades gracefully and shows a diagnostic banner.

import { NextResponse } from 'next/server';
import type { Client } from 'minio';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';

export const dynamic = 'force-dynamic';

// ----- Public response types -----

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'unknown';

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'unknown';

export type TaskOutcome = 'SUCCESS' | 'SUCCESS_WITH_NOTES' | 'REVISION_NEEDED' | 'BLOCKED' | null;

export interface PhasePlan {
  /** "Phase 1", "Phase 2: design", or whatever the manager wrote. */
  heading: string;
  /** Tasks listed under this phase. */
  items: PlanItem[];
}

export interface PlanItem {
  /** Raw bracket prefix: '[ ]', '[~]', '[x]', '[!]', '[→]'. */
  marker: string;
  /** The task id if it can be parsed (matches `task-YYYYMMDD-HHMMSS`). */
  taskId?: string;
  /** Owner name as parsed from `(owner: <name>)`; otherwise undefined. */
  owner?: string;
  /** Free-form title text after the task id. */
  text: string;
  /** True when marker is `[~]` (in-progress). */
  inProgress: boolean;
  /** True when marker is `[x]`. */
  done: boolean;
  /** True when marker is `[!]`. */
  blocked: boolean;
}

export interface TaskBoardTask {
  runId: string; // canonical id (meta.json's task_id; falls back to runId/run_id for legacy)
  title: string;
  status: TaskStatus;
  /** Owning worker Matrix user id or display name. */
  assignedTo: string;
  /** Owning project id when the task was created under a project. */
  projectId?: string;
  /** Matrix room id where the manager / worker is collaborating. */
  roomId: string;
  /** Worker dependency ids. */
  dependsOn: string[];
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms, only set when status === 'completed'. */
  completedAt?: number;
  /** Parsed from result.md `## Outcome`. */
  outcome: TaskOutcome;
  /** Free-form spec body if the file is small (< 4 KB). */
  spec?: string;
  /** Where the entry was loaded from — `shared/tasks/{id}`, etc. */
  source: string;
}

export interface TaskBoardProject {
  runId: string; // project id
  name: string;
  status: ProjectStatus;
  /** Project room id. */
  roomId: string;
  /** Leader (Manager) display name. */
  leader?: string;
  /** Worker display names listed on the project. */
  workers: string[];
  /** Phase headings + their plan items. */
  phases: PhasePlan[];
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms, set when status === 'completed'. */
  completedAt?: number;
  source: string;
}

export interface TeamTasksResponse {
  tasks: TaskBoardTask[];
  projects: TaskBoardProject[];
  scannedKeys: string[];
  matchedPrefixes: string[];
  bucket: string | null;
  scannedAt: number;
  error?: string;
}

// ----- Internals -----

const SHARED_TASKS_PREFIX = 'shared/tasks/';
const SHARED_PROJECTS_PREFIX = 'shared/projects/';
const AGENTS_PREFIX = 'agents/';
const WORKER_HISTORY_FILENAME = 'task-history.json';

const SPEC_MAX_BYTES = 4 * 1024;

interface RawMeta {
  task_id?: string;
  taskId?: string;
  runId?: string;
  run_id?: string;
  id?: string;
  task_title?: string;
  title?: string;
  name?: string;
  status?: string;
  assigned_to?: string;
  owner?: string;
  project_id?: string;
  projectId?: string;
  room_id?: string;
  roomId?: string;
  depends_on?: string[];
  dependsOn?: string[];
  assigned_at?: string | number;
  created_at?: string | number;
  completed_at?: string | number;
  [k: string]: unknown;
}

interface RawProjectMeta {
  project_id?: string;
  projectId?: string;
  runId?: string;
  run_id?: string;
  id?: string;
  project_name?: string;
  name?: string;
  title?: string;
  status?: string;
  project_room_id?: string;
  roomId?: string;
  room_id?: string;
  leader?: string;
  leaderName?: string;
  workers?: string[];
  members?: string[];
  created_at?: string | number;
  confirmed_at?: string | number;
  completed_at?: string | number;
  [k: string]: unknown;
}

interface ListResult {
  prefixes: string[];
  files: string[];
}

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

function normalizeStatus(raw?: string): TaskStatus {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'pending' || lower === 'queued' || lower === 'planning') return 'pending';
  if (lower === 'assigned' || lower === 'todo' || lower === 'open') return 'assigned';
  if (
    lower === 'in_progress' ||
    lower === 'in-progress' ||
    lower === 'inprogress' ||
    lower === 'running' ||
    lower === 'active' ||
    lower === 'working'
  )
    return 'in_progress';
  if (lower === 'completed' || lower === 'success' || lower === 'done' || lower === 'finished')
    return 'completed';
  if (lower === 'failed' || lower === 'error') return 'failed';
  if (lower === 'blocked' || lower === 'paused' || lower === 'waiting') return 'blocked';
  return 'unknown';
}

function normalizeProjectStatus(raw?: string): ProjectStatus {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'planning' || lower === 'draft') return 'planning';
  if (lower === 'active' || lower === 'in_progress' || lower === 'running') return 'active';
  if (lower === 'paused' || lower === 'blocked') return 'paused';
  if (lower === 'completed' || lower === 'done' || lower === 'finished') return 'completed';
  return 'unknown';
}

function pickRunId(meta: RawMeta): string | null {
  if (typeof meta.task_id === 'string') return meta.task_id;
  if (typeof meta.taskId === 'string') return meta.taskId;
  if (typeof meta.runId === 'string') return meta.runId;
  if (typeof meta.run_id === 'string') return meta.run_id;
  if (typeof meta.id === 'string') return meta.id;
  return null;
}

function pickProjectId(meta: RawProjectMeta): string | null {
  if (typeof meta.project_id === 'string') return meta.project_id;
  if (typeof meta.projectId === 'string') return meta.projectId;
  if (typeof meta.runId === 'string') return meta.runId;
  if (typeof meta.run_id === 'string') return meta.run_id;
  if (typeof meta.id === 'string') return meta.id;
  return null;
}

function normalizeTask(
  meta: RawMeta,
  source: string,
  now: number,
  outcome: TaskOutcome,
  spec?: string,
): TaskBoardTask | null {
  if (!isObject(meta)) return null;
  const runId = pickRunId(meta);
  if (!runId) return null;
  const created = toEpochMs(
    meta.assigned_at ?? meta.created_at,
    now,
  );
  const completed = toEpochMs(meta.completed_at, 0) || undefined;
  const status = normalizeStatus(meta.status);
  return {
    runId,
    title:
      (typeof meta.task_title === 'string' && meta.task_title) ||
      (typeof meta.title === 'string' && meta.title) ||
      (typeof meta.name === 'string' && meta.name) ||
      '未命名任务',
    status,
    assignedTo:
      (typeof meta.assigned_to === 'string' && meta.assigned_to) ||
      (typeof meta.owner === 'string' && meta.owner) ||
      '',
    projectId:
      (typeof meta.project_id === 'string' && meta.project_id) ||
      (typeof meta.projectId === 'string' && meta.projectId) ||
      undefined,
    roomId:
      (typeof meta.room_id === 'string' && meta.room_id) ||
      (typeof meta.roomId === 'string' && meta.roomId) ||
      '',
    dependsOn: Array.isArray(meta.depends_on)
      ? (meta.depends_on as string[]).filter((d) => typeof d === 'string')
      : Array.isArray(meta.dependsOn)
        ? (meta.dependsOn as string[]).filter((d) => typeof d === 'string')
        : [],
    createdAt: created,
    completedAt: status === 'completed' ? completed : undefined,
    outcome,
    spec,
    source,
  };
}

function normalizeProject(
  meta: RawProjectMeta,
  source: string,
  now: number,
  phases: PhasePlan[],
): TaskBoardProject | null {
  if (!isObject(meta)) return null;
  const runId = pickProjectId(meta);
  if (!runId) return null;
  const created = toEpochMs(meta.created_at ?? meta.confirmed_at, now);
  const completed = toEpochMs(meta.completed_at, 0) || undefined;
  return {
    runId,
    name:
      (typeof meta.project_name === 'string' && meta.project_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      (typeof meta.title === 'string' && meta.title) ||
      runId,
    status: normalizeProjectStatus(meta.status),
    roomId:
      (typeof meta.project_room_id === 'string' && meta.project_room_id) ||
      (typeof meta.roomId === 'string' && meta.roomId) ||
      (typeof meta.room_id === 'string' && meta.room_id) ||
      '',
    leader:
      (typeof meta.leader === 'string' && meta.leader) ||
      (typeof meta.leaderName === 'string' && meta.leaderName) ||
      undefined,
    workers: Array.isArray(meta.workers)
      ? (meta.workers as string[]).filter((w) => typeof w === 'string')
      : Array.isArray(meta.members)
        ? (meta.members as string[]).filter((w) => typeof w === 'string')
        : [],
    phases,
    createdAt: created,
    completedAt: normalizeProjectStatus(meta.status) === 'completed' ? completed : undefined,
    source,
  };
}

// ----- plan.md / result.md parsers -----

const PLAN_TASK_ID_RE = /task-\d{8}-\d{6}/;
const PLAN_OWNER_RE = /\(owner:\s*([^)\s]+)\s*\)/i;
const PHASE_HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;

const RESULT_OUTCOME_RE =
  /^##\s+Outcome\s*[:：]?\s*([A-Z_]+).*$/im;

function parseOutcomeFromResult(resultMd: string | null): TaskOutcome {
  if (!resultMd) return null;
  const match = resultMd.match(RESULT_OUTCOME_RE);
  if (!match) return null;
  const raw = match[1].toUpperCase();
  if (raw === 'SUCCESS') return 'SUCCESS';
  if (raw === 'SUCCESS_WITH_NOTES') return 'SUCCESS_WITH_NOTES';
  if (raw === 'REVISION_NEEDED') return 'REVISION_NEEDED';
  if (raw === 'BLOCKED') return 'BLOCKED';
  return null;
}

function parsePlan(planMd: string | null): PhasePlan[] {
  if (!planMd) return [];
  const lines = planMd.split(/\r?\n/);
  const phases: PhasePlan[] = [];
  let current: PhasePlan | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const heading = line.match(PHASE_HEADING_RE);
    if (heading) {
      const headingText = heading[2].trim();
      if (/^phase\b/i.test(headingText)) {
        current = { heading: headingText, items: [] };
        phases.push(current);
        continue;
      }
      // Non-phase heading ends the current phase list.
      current = null;
      continue;
    }

    const itemMatch = line.match(/^[-*]\s+\[([ x~!→])\]\s+(.+)$/);
    if (itemMatch && current) {
      const marker = `[${itemMatch[1]}]`;
      const rest = itemMatch[2].trim();
      const idMatch = rest.match(PLAN_TASK_ID_RE);
      const ownerMatch = rest.match(PLAN_OWNER_RE);
      current.items.push({
        marker,
        taskId: idMatch ? idMatch[0] : undefined,
        owner: ownerMatch ? ownerMatch[1] : undefined,
        text: rest,
        inProgress: itemMatch[1] === '~',
        done: itemMatch[1] === 'x',
        blocked: itemMatch[1] === '!',
      });
    }
  }
  return phases;
}

// ----- MinIO IO -----

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
  maxBytes = 256 * 1024,
): Promise<string | null> {
  try {
    const stat = await client.statObject(bucket, key);
    if (stat.size > maxBytes) return null;
    const stream = await client.getObject(bucket, key);
    return new Promise<string | null>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
      stream.on('close', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
  } catch {
    return null;
  }
}

// ----- Source collectors -----

async function collectSharedTasks(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ tasks: TaskBoardTask[]; scannedKeys: string[] }> {
  const out = { tasks: [] as TaskBoardTask[], scannedKeys: [] as string[] };
  let list: ListResult;
  try {
    list = await listAtPrefix(client, bucket, SHARED_TASKS_PREFIX);
  } catch {
    return out;
  }
  for (const taskPrefix of list.prefixes) {
    const metaKey = `${taskPrefix}meta.json`;
    const metaText = await getObjectText(client, bucket, metaKey);
    if (!metaText) continue;
    out.scannedKeys.push(metaKey);
    let meta: RawMeta;
    try {
      meta = JSON.parse(metaText);
    } catch {
      continue;
    }
    const source = taskPrefix.replace(/\/$/, '');
    // result.md drives the outcome field.
    const resultText = await getObjectText(
      client,
      bucket,
      `${taskPrefix}result.md`,
    );
    if (resultText) out.scannedKeys.push(`${taskPrefix}result.md`);
    const outcome = parseOutcomeFromResult(resultText);
    // spec.md is optional and bounded.
    const specText = await getObjectText(
      client,
      bucket,
      `${taskPrefix}spec.md`,
      SPEC_MAX_BYTES,
    );
    if (specText) out.scannedKeys.push(`${taskPrefix}spec.md`);
    const task = normalizeTask(meta, source, now, outcome, specText ?? undefined);
    if (task) out.tasks.push(task);
  }
  return out;
}

async function collectSharedProjects(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ projects: TaskBoardProject[]; scannedKeys: string[] }> {
  const out = { projects: [] as TaskBoardProject[], scannedKeys: [] as string[] };
  let list: ListResult;
  try {
    list = await listAtPrefix(client, bucket, SHARED_PROJECTS_PREFIX);
  } catch {
    return out;
  }
  for (const projectPrefix of list.prefixes) {
    const metaKey = `${projectPrefix}meta.json`;
    const metaText = await getObjectText(client, bucket, metaKey);
    if (!metaText) continue;
    out.scannedKeys.push(metaKey);
    let meta: RawProjectMeta;
    try {
      meta = JSON.parse(metaText);
    } catch {
      continue;
    }
    const source = projectPrefix.replace(/\/$/, '');
    const planText = await getObjectText(
      client,
      bucket,
      `${projectPrefix}plan.md`,
    );
    if (planText) out.scannedKeys.push(`${projectPrefix}plan.md`);
    const phases = parsePlan(planText);
    const project = normalizeProject(meta, source, now, phases);
    if (project) out.projects.push(project);
  }
  return out;
}

async function collectWorkerHistories(
  client: Client,
  bucket: string,
  now: number,
): Promise<{ tasks: TaskBoardTask[]; scannedKeys: string[] }> {
  const out = { tasks: [] as TaskBoardTask[], scannedKeys: [] as string[] };
  let list: ListResult;
  try {
    list = await listAtPrefix(client, bucket, AGENTS_PREFIX);
  } catch {
    return out;
  }
  await Promise.all(
    list.prefixes.map(async (agentPrefix) => {
      const key = `${agentPrefix}${WORKER_HISTORY_FILENAME}`;
      const text = await getObjectText(client, bucket, key);
      if (!text) return;
      out.scannedKeys.push(key);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      const arr = Array.isArray(parsed) ? parsed : [];
      for (const raw of arr) {
        if (!isObject(raw)) continue;
        const task = normalizeTask(raw as RawMeta, agentPrefix, now, null);
        if (task) out.tasks.push(task);
      }
    }),
  );
  return out;
}

export async function GET() {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json(
      {
        tasks: [],
        projects: [],
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
        projects: [],
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
  const [tasksSrc, projectsSrc, historySrc] = await Promise.all([
    collectSharedTasks(client, bucket, now),
    collectSharedProjects(client, bucket, now),
    collectWorkerHistories(client, bucket, now),
  ]);

  // Merge by runId. shared/tasks/ entries win over worker history so the
  // canonical state takes precedence.
  const taskById = new Map<string, TaskBoardTask>();
  for (const t of [...tasksSrc.tasks, ...historySrc.tasks]) {
    taskById.set(t.runId, t);
  }

  // Project tasks are referenced from their plan.md; back-link tasks to
  // projects via projectId when both are present.
  const projectById = new Map<string, TaskBoardProject>();
  for (const p of projectsSrc.projects) {
    projectById.set(p.runId, p);
  }
  for (const t of taskById.values()) {
    if (t.projectId && projectById.has(t.projectId)) {
      const proj = projectById.get(t.projectId);
      if (proj && !proj.workers.includes(t.assignedTo) && t.assignedTo) {
        // The task's owner may be missing from the project-level workers
        // list. Don't auto-merge; plan.md is the source of truth here.
      }
    }
  }

  const matchedPrefixes: string[] = [];
  if (tasksSrc.scannedKeys.length > 0) matchedPrefixes.push(SHARED_TASKS_PREFIX);
  if (projectsSrc.scannedKeys.length > 0) matchedPrefixes.push(SHARED_PROJECTS_PREFIX);
  if (historySrc.scannedKeys.length > 0) matchedPrefixes.push(`${AGENTS_PREFIX} (worker-history)`);

  return NextResponse.json({
    tasks: Array.from(taskById.values()).sort((a, b) => b.createdAt - a.createdAt),
    projects: Array.from(projectById.values()).sort((a, b) => b.createdAt - a.createdAt),
    scannedKeys: [
      ...tasksSrc.scannedKeys,
      ...projectsSrc.scannedKeys,
      ...historySrc.scannedKeys,
    ],
    matchedPrefixes,
    bucket,
    scannedAt: now,
  });
}

/** Test-only export. */
export const __test__ = {
  normalizeTask,
  normalizeProject,
  parsePlan,
  parseOutcomeFromResult,
  pickRunId,
  pickProjectId,
  normalizeStatus,
  normalizeProjectStatus,
};
