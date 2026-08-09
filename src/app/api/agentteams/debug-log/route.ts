// POST /api/agentteams/debug-log — one-click debug log collection.
//
// Port of the AgentTeams scripts/export-debug-log.py standalone tool. Instead
// of shelling out to `docker`/`kubectl`, it goes through the Controller's
// Docker API reverse proxy (container list/inspect/logs/exec) and the Matrix
// Client-Server API, then bundles everything into a ZIP download:
//
//   agentteams-debug-log-<ts>.zip
//   ├── summary.txt
//   ├── matrix-messages/<RoomName>_<roomid>.jsonl   (requires Matrix login)
//   ├── agent-sessions/<container>/<session>.jsonl
//   └── container-logs/<container>.log + .state.json

import { NextRequest, NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { getAuthToken, getControllerUrl } from '../proxy-helper';
import { redactPii, redactJsonStrings } from './redact';
import {
  DockerContext,
  getContainerLogs,
  inspectContainer,
  listAgentTeamsContainers,
} from './docker';
import { exportAgentSessions } from './sessions';
import { exportMatrixMessages } from './matrix';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Hard limits so an unbounded request cannot exhaust memory or run past the
// route timeout. Collection stops early (with a summary note) once a limit is hit.
const MAX_RANGE_SECONDS = 30 * 24 * 3600; // 30 days
const MAX_CONTAINERS = 100;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024; // 256 MiB across all collected files
const COLLECT_DEADLINE_MS = 240_000; // stop collecting well before maxDuration
const NOTE_MAX_LENGTH = 500;

function parseRange(rangeStr: string): number {
  const m = /^(\d+)\s*(m|min|h|hr|hour|d|day)s?$/i.exec(rangeStr.trim());
  if (!m) {
    throw new Error(`Invalid range format: '${rangeStr}'. Use e.g. 10m, 1h, 1d`);
  }
  const value = parseInt(m[1], 10);
  const unit = m[2][0].toLowerCase();
  const multiplier = unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  const seconds = value * multiplier;
  if (value <= 0) {
    throw new Error('Range must be a positive number');
  }
  if (seconds > MAX_RANGE_SECONDS) {
    throw new Error('Range too large: maximum is 30d');
  }
  return seconds;
}

interface DebugLogRequest {
  range?: string;
  redact?: boolean;
  container?: string;
  room?: string;
  messagesOnly?: boolean;
  homeserver?: string;
}

interface CollectBudget {
  startedAt: number;
  totalBytes: number;
  exhausted: boolean;
  reason: string;
}

function createBudget(): CollectBudget {
  return { startedAt: Date.now(), totalBytes: 0, exhausted: false, reason: '' };
}

function budgetExhausted(budget: CollectBudget): boolean {
  if (budget.exhausted) return true;
  if (Date.now() - budget.startedAt > COLLECT_DEADLINE_MS) {
    budget.exhausted = true;
    budget.reason = 'collection time budget exceeded';
    return true;
  }
  if (budget.totalBytes >= MAX_TOTAL_BYTES) {
    budget.exhausted = true;
    budget.reason = 'total collected bytes exceeded';
    return true;
  }
  return false;
}

/** Add a file to the bundle unless a limit is hit; returns false when stopped. */
function addFile(
  files: Record<string, Uint8Array>,
  budget: CollectBudget,
  name: string,
  data: Uint8Array
): boolean {
  if (budgetExhausted(budget)) return false;
  budget.totalBytes += data.byteLength;
  if (budget.totalBytes > MAX_TOTAL_BYTES) {
    budget.exhausted = true;
    budget.reason = 'total collected bytes exceeded';
    return false;
  }
  files[name] = data;
  return true;
}

/** Normalize an upstream error into a redacted, length-capped summary note. */
function noteFor(prefix: string, err: unknown): string {
  const message = err instanceof Error ? err.message : 'unknown error';
  return `${prefix}: ${redactPii(message).slice(0, NOTE_MAX_LENGTH)}`;
}

function parseBody(value: unknown): { body: DebugLogRequest; error?: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { body: {}, error: 'Invalid JSON body' };
  }
  const body = value as Record<string, unknown>;
  for (const key of ['range', 'container', 'room', 'homeserver'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      return { body: {}, error: `Field '${key}' must be a string` };
    }
  }
  for (const key of ['redact', 'messagesOnly'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return { body: {}, error: `Field '${key}' must be a boolean` };
    }
  }
  return { body: body as unknown as DebugLogRequest };
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parseBody(rawBody);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.body;

  const rangeStr = body.range || '1h';
  let rangeSeconds: number;
  try {
    rangeSeconds = parseRange(rangeStr);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid range' },
      { status: 400 }
    );
  }

  const redact = body.redact !== false;
  const containerFilter = body.container?.trim() || '';
  const roomFilter = body.room?.trim() || '';
  const sinceEpochSec = Date.now() / 1000 - rangeSeconds;
  const sinceHuman = new Date(sinceEpochSec * 1000).toISOString();
  const nowStr = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
    .replace(/(\d{8})(\d{6})/, '$1-$2');

  const files: Record<string, Uint8Array> = {};
  const notes: string[] = [];
  const budget = createBudget();

  const controllerUrl = getControllerUrl(request);
  const token = await getAuthToken();
  const ctx: DockerContext = { controllerUrl, token };

  // --- Container list (shared by diagnostics + session export) -------------
  let containers: string[] = [];
  try {
    containers = await listAgentTeamsContainers(ctx);
    if (containerFilter) {
      containers = containers.filter((n) => n.includes(containerFilter));
    }
    containers = containers.slice(0, MAX_CONTAINERS);
    if (containers.length === MAX_CONTAINERS) {
      notes.push(`Container listing truncated to ${MAX_CONTAINERS} containers`);
    }
  } catch (err) {
    notes.push(noteFor('Container listing failed', err));
  }

  // --- Container diagnostics (state + logs) --------------------------------
  let containersWithLogs = 0;
  for (const name of containers) {
    if (budgetExhausted(budget)) break;
    try {
      const diagnostic = await inspectContainer(ctx, name);
      const data = strToU8(
        JSON.stringify(redact ? redactJsonStrings(diagnostic) : diagnostic, null, 2) + '\n'
      );
      addFile(files, budget, `container-logs/${name}.state.json`, data);
    } catch (err) {
      notes.push(noteFor(`${name}: inspect failed`, err));
    }
    if (budgetExhausted(budget)) break;
    try {
      const logs = await getContainerLogs(ctx, name, sinceEpochSec);
      const stored = addFile(
        files,
        budget,
        `container-logs/${name}.log`,
        strToU8(redact ? redactPii(logs) : logs)
      );
      if (stored) containersWithLogs += 1;
    } catch (err) {
      notes.push(noteFor(`${name}: logs failed`, err));
    }
  }

  // --- Agent sessions -------------------------------------------------------
  let sessionStats = { sessions: 0, events: 0 };
  if (containers.length > 0 && !budgetExhausted(budget)) {
    try {
      const stop = () => budgetExhausted(budget);
      const sessions = await exportAgentSessions(ctx, containers, sinceEpochSec, redact, stop);
      for (const [path, content] of Object.entries(sessions.files)) {
        if (!addFile(files, budget, path, strToU8(content))) break;
      }
      sessionStats = { sessions: sessions.sessions, events: sessions.events };
      notes.push(...sessions.errors);
    } catch (err) {
      notes.push(noteFor('Session export failed', err));
    }
  }

  // --- Matrix messages ------------------------------------------------------
  // Uses the browser's Matrix credentials (Authorization header + homeserver),
  // same convention as the other /api/matrix/* routes. Skipped when the user
  // is not logged in to Matrix.
  let matrixStats = { rooms: 0, messages: 0 };
  const matrixToken = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '');
  const homeserver =
    body.homeserver?.trim() || request.nextUrl.searchParams.get('homeserver') || '';

  if (matrixToken && homeserver) {
    try {
      const stop = () => budgetExhausted(budget);
      const matrix = await exportMatrixMessages({
        homeserver,
        token: matrixToken,
        sinceEpochSec,
        redact,
        roomFilter: roomFilter || undefined,
        messagesOnly: body.messagesOnly,
        stop,
      });
      for (const [path, content] of Object.entries(matrix.files)) {
        if (!addFile(files, budget, path, strToU8(content))) break;
      }
      matrixStats = { rooms: matrix.rooms, messages: matrix.messages };
      if (matrix.error) notes.push(redactPii(matrix.error).slice(0, NOTE_MAX_LENGTH));
    } catch (err) {
      notes.push(noteFor('Matrix export failed', err));
    }
  } else {
    notes.push('Matrix export skipped: no Matrix credentials (log in to Matrix first)');
  }

  if (budget.exhausted) {
    notes.push(`Collection stopped early: ${budget.reason}`);
  }

  // --- Summary --------------------------------------------------------------
  const summary = [
    'AgentTeams Debug Log',
    `Exported at: ${nowStr}`,
    `Range: last ${rangeStr} (since ${sinceHuman})`,
    `PII redaction: ${redact ? 'on' : 'off'}`,
    '',
    `Matrix messages: ${matrixStats.messages} messages from ${matrixStats.rooms} rooms`,
    `Agent sessions: ${sessionStats.events} events from ${sessionStats.sessions} sessions`,
    `Container diagnostics: ${containersWithLogs} containers`,
    ...(notes.length > 0 ? ['', 'Notes:', ...notes.map((n) => `  - ${n}`)] : []),
    '',
  ].join('\n');
  files['summary.txt'] = strToU8(summary);

  // --- Bundle ---------------------------------------------------------------
  const zipped = zipSync(files, { level: 6 });
  const filename = `agentteams-debug-log-${nowStr}.zip`;

  return new NextResponse(zipped as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
