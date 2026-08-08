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

function parseRange(rangeStr: string): number {
  const m = /^(\d+)\s*(m|min|h|hr|hour|d|day)s?$/i.exec(rangeStr.trim());
  if (!m) {
    throw new Error(`Invalid range format: '${rangeStr}'. Use e.g. 10m, 1h, 1d`);
  }
  const value = parseInt(m[1], 10);
  const unit = m[2][0].toLowerCase();
  const multiplier = unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * multiplier;
}

interface DebugLogRequest {
  range?: string;
  redact?: boolean;
  container?: string;
  room?: string;
  messagesOnly?: boolean;
  homeserver?: string;
}

export async function POST(request: NextRequest) {
  let body: DebugLogRequest = {};
  try {
    body = (await request.json()) as DebugLogRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

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
  } catch (err) {
    notes.push(
      `Container listing failed: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }

  // --- Container diagnostics (state + logs) --------------------------------
  let containersWithLogs = 0;
  for (const name of containers) {
    try {
      const diagnostic = await inspectContainer(ctx, name);
      files[`container-logs/${name}.state.json`] = strToU8(
        JSON.stringify(redact ? redactJsonStrings(diagnostic) : diagnostic, null, 2) + '\n'
      );
    } catch (err) {
      notes.push(
        `${name}: inspect failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
    try {
      const logs = await getContainerLogs(ctx, name, sinceEpochSec);
      files[`container-logs/${name}.log`] = strToU8(redact ? redactPii(logs) : logs);
      containersWithLogs += 1;
    } catch (err) {
      notes.push(
        `${name}: logs failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
  }

  // --- Agent sessions -------------------------------------------------------
  let sessionStats = { sessions: 0, events: 0 };
  if (containers.length > 0) {
    try {
      const sessions = await exportAgentSessions(ctx, containers, sinceEpochSec, redact);
      for (const [path, content] of Object.entries(sessions.files)) {
        files[path] = strToU8(content);
      }
      sessionStats = { sessions: sessions.sessions, events: sessions.events };
      notes.push(...sessions.errors);
    } catch (err) {
      notes.push(
        `Session export failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
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
      const matrix = await exportMatrixMessages({
        homeserver,
        token: matrixToken,
        sinceEpochSec,
        redact,
        roomFilter: roomFilter || undefined,
        messagesOnly: body.messagesOnly,
      });
      for (const [path, content] of Object.entries(matrix.files)) {
        files[path] = strToU8(content);
      }
      matrixStats = { rooms: matrix.rooms, messages: matrix.messages };
      if (matrix.error) notes.push(`Matrix export: ${matrix.error}`);
    } catch (err) {
      notes.push(
        `Matrix export failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
  } else {
    notes.push('Matrix export skipped: no Matrix credentials (log in to Matrix first)');
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
