// GET /api/agentteams/team-tasks
//
// Aggregate task files persisted by AgentTeams workers/managers into a
// normalized list of task entries. The server side is the only place that
// knows the configured MinIO bucket (it comes from
// AGENTTEAMS_FS_BUCKET / AGENTTEAMS_MINIO_BUCKET env vars), so probing
// candidate prefixes must happen here.
//
// We accept a few different file layouts produced by the controller/agent
// side, in order of likelihood:
//   1) team/{teamName}/tasks.json                (aggregated array)
//   2) team/{teamName}/task.json                 (singular aggregated file)
//   3) team/{teamName}/task/{runId}.json         (one file per task)
//   4) teams/{teamName}/tasks.json               (plural top-level)
//   5) shared/teams/{teamName}/tasks.json
//   6) shared/tasks/{teamName}.json or {runId}.json
//
// Each individual file may be:
//   - a single task object { runId, title, ... }
//   - a top-level array of task objects
//   - an envelope { tasks: [...] } (some controllers wrap the array)
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
}

const CANDIDATE_PREFIXES = [
  'team/',
  'teams/',
  'shared/teams/',
  'shared/tasks/',
  'team-tasks/',
] as const;

const CANDIDATE_FILE_NAMES = ['tasks.json', 'task.json'] as const;

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

function normalizeTask(raw: RawTask, now: number): TaskEntry | null {
  if (!isObject(raw) || typeof raw.runId !== 'string' || raw.runId.length === 0) {
    return null;
  }
  const created = toEpochMs(raw.createdAt, now);
  const updated = toEpochMs(raw.updatedAt, created);
  return {
    runId: raw.runId,
    title: typeof raw.title === 'string' ? raw.title : '未命名任务',
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    roomId: typeof raw.roomId === 'string' ? raw.roomId : '',
    senderMatrixUserId:
      typeof raw.senderMatrixUserId === 'string' ? raw.senderMatrixUserId : '',
    createdAt: created,
    updatedAt: updated,
    subagents: Array.isArray(raw.subagents) ? (raw.subagents as RawTask[]) : [],
    steps: Array.isArray(raw.steps) ? (raw.steps as RawTask[]) : [],
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
  return [];
}

interface ListResult {
  prefixes: string[];
  files: string[];
}

async function listAtPrefix(client: Client, bucket: string, prefix: string): Promise<ListResult> {
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

async function getObjectText(client: Client, bucket: string, key: string): Promise<string | null> {
  try {
    const stream = await client.getObject(bucket, key);
    return new Promise<string | null>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('close', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
  } catch {
    return null;
  }
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

  const tasks: TaskEntry[] = [];
  const scannedKeys: string[] = [];
  const matchedPrefixes: string[] = [];
  const now = Date.now();

  for (const prefix of CANDIDATE_PREFIXES) {
    let list: ListResult;
    try {
      list = await listAtPrefix(client, bucket, prefix);
    } catch {
      continue;
    }

    const { prefixes, files } = list;
    if (prefixes.length === 0 && files.length === 0) continue;

    // Layout 1+2: prefix/{team}/tasks.json
    for (const subPrefix of prefixes) {
      for (const filename of CANDIDATE_FILE_NAMES) {
        const key = `${subPrefix}${filename}`;
        const text = await getObjectText(client, bucket, key);
        if (text) {
          scannedKeys.push(key);
          try {
            const parsed = JSON.parse(text);
            for (const t of unwrapFileContent(parsed)) {
              const normalized = normalizeTask(t, now);
              if (normalized) tasks.push(normalized);
            }
          } catch {
            // ignore parse errors
          }
          break;
        }
      }

      // Layout 3: prefix/{team}/task/{runId}.json (one file per task)
      try {
        const deeper = await listAtPrefix(client, bucket, subPrefix);
        for (const fileKey of deeper.files) {
          if (!/\.json$/i.test(fileKey)) continue;
          const text = await getObjectText(client, bucket, fileKey);
          if (!text) continue;
          scannedKeys.push(fileKey);
          try {
            const parsed = JSON.parse(text);
            for (const t of unwrapFileContent(parsed)) {
              const normalized = normalizeTask(t, now);
              if (normalized) tasks.push(normalized);
            }
          } catch {
            // ignore parse errors
          }
        }
      } catch {
        // ignore
      }
    }

    // Layout 4: bare .json files directly under the prefix
    for (const fileKey of files) {
      if (!/\.json$/i.test(fileKey)) continue;
      const text = await getObjectText(client, bucket, fileKey);
      if (!text) continue;
      scannedKeys.push(fileKey);
      try {
        const parsed = JSON.parse(text);
        for (const t of unwrapFileContent(parsed)) {
          const normalized = normalizeTask(t, now);
          if (normalized) tasks.push(normalized);
        }
      } catch {
        // ignore
      }
    }

    if (scannedKeys.length > 0 && !matchedPrefixes.includes(prefix)) {
      matchedPrefixes.push(prefix);
    }
  }

  return NextResponse.json({
    tasks,
    scannedKeys,
    matchedPrefixes,
    bucket,
    scannedAt: now,
  });
}
