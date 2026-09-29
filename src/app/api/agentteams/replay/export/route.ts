import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exportMatrixMessages } from '../../debug-log/matrix';
import { readServerIdentity } from '@/lib/server-auth';

/**
 * D3 replay export: turns a Matrix room's message history into a sanitized,
 * shareable read-only replay bundle. The bundle lives server-side and is
 * addressed by a 128-bit capability id — whoever holds the URL can read the
 * (already PII-redacted) transcript; there is no listing endpoint.
 */

const REPLAY_ID_PATTERN = /^[a-f0-9]{32}$/;

export function replayDir(): string {
  return process.env.AGENTTEAMS_REPLAY_DIR || '/data/agentteams-dashboard/replays';
}

export function isReplayId(id: string): boolean {
  return REPLAY_ID_PATTERN.test(id);
}

export async function POST(request: NextRequest) {
  const identity = readServerIdentity(request);
  if (!identity) {
    return NextResponse.json({ error: '登录后才能导出会话回放' }, { status: 401 });
  }

  let body: { homeserver?: string; room?: string; sinceEpochSec?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const homeserver = typeof body.homeserver === 'string' ? body.homeserver : '';
  const room = typeof body.room === 'string' ? body.room : '';
  const sinceEpochSec =
    typeof body.sinceEpochSec === 'number' && Number.isFinite(body.sinceEpochSec)
      ? body.sinceEpochSec
      : 0;
  if (!homeserver || !room) {
    return NextResponse.json({ error: 'homeserver and room are required' }, { status: 400 });
  }

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) {
    return NextResponse.json({ error: 'Missing Matrix access token' }, { status: 401 });
  }

  const result = await exportMatrixMessages({
    homeserver,
    token,
    sinceEpochSec,
    redact: true,
    roomFilter: room,
    messagesOnly: true,
  });
  if (result.error || result.messages === 0) {
    return NextResponse.json(
      { error: result.error || 'no messages exported for the given room filter' },
      { status: 502 },
    );
  }

  const replayId = crypto.randomBytes(16).toString('hex');
  const dir = replayDir();
  await fs.mkdir(dir, { recursive: true });
  const bundle = {
    replayId,
    createdAt: new Date().toISOString(),
    room,
    exportedBy: identity.name,
    messages: result.messages,
    files: result.files,
  };
  await fs.writeFile(path.join(dir, `${replayId}.json`), JSON.stringify(bundle), 'utf8');

  return NextResponse.json({
    replayId,
    url: `/replay/${replayId}`,
    messages: result.messages,
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!isReplayId(id)) {
    return NextResponse.json({ error: 'invalid replay id' }, { status: 400 });
  }
  try {
    const raw = await fs.readFile(path.join(replayDir(), `${id}.json`), 'utf8');
    return new NextResponse(raw, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'replay not found' }, { status: 404 });
    }
    throw err;
  }
}
