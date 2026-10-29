import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exportMatrixMessages } from '../../debug-log/matrix';
import { readServerIdentity } from '@/lib/server-auth';
import { listAuditEvents, type AuditEventRecord } from '@/lib/audit-log';
import { parseAuditRef } from '@/lib/replay/audit-ref';

/**
 * D3 replay export: turns a Matrix room's message history into a sanitized,
 * shareable read-only replay bundle. The bundle lives server-side and is
 * addressed by a 128-bit capability id — whoever holds the URL can read the
 * (already PII-redacted) transcript; there is no listing endpoint.
 */

const REPLAY_ID_PATTERN = /^[a-f0-9]{32}$/;

export function replayDir(): string {
  if (process.env.AGENTTEAMS_REPLAY_DIR) {
    return process.env.AGENTTEAMS_REPLAY_DIR;
  }
  // Windows 开发环境没有 /data/agentteams-dashboard/replays 根目录，回退到系统临时目录或工作区
  if (process.platform === 'win32') {
    return path.join(process.cwd(), '.data', 'replays');
  }
  return '/data/agentteams-dashboard/replays';
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

  // 收集该房间相关的 hitl.* / release.* 等审计事件快照存入回放包（D-2）
  let auditEvents: AuditEventRecord[] = [];
  try {
    const allAudit = await listAuditEvents({ limit: 500 });
    auditEvents = allAudit.filter((ev) => {
      const ref = parseAuditRef(ev);
      return (
        ref.roomId === room ||
        ev.entity_name === room ||
        (ev.action.startsWith('hitl.') && ref.roomId === room) ||
        (ev.action.startsWith('release.') && (ref.roomId === room || ev.entity_name === room))
      );
    });
  } catch {
    // 降级：日志获取失败时不阻塞回放生成
  }

  const bundle = {
    replayId,
    createdAt: new Date().toISOString(),
    room,
    exportedBy: identity.name,
    messages: result.messages,
    files: result.files,
    auditEvents,
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
  const room = url.searchParams.get('room') || '';

  // 1. 如果传入 room 参数，扫描 replayDir 返回该房间最新的一条回放包引用（用于审计互查深链）
  if (room) {
    try {
      const dir = replayDir();
      const files = await fs.readdir(dir);
      let latestReplayId: string | null = null;
      let latestTime = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(dir, file), 'utf8');
          const data = JSON.parse(raw) as { replayId?: string; room?: string; createdAt?: string };
          if (data.room === room && data.replayId) {
            const time = data.createdAt ? new Date(data.createdAt).getTime() : 0;
            if (time >= latestTime) {
              latestTime = time;
              latestReplayId = data.replayId;
            }
          }
        } catch {
          // ignore corrupted files
        }
      }

      if (latestReplayId) {
        return NextResponse.json({
          found: true,
          replayId: latestReplayId,
          url: `/replay/${latestReplayId}`,
        });
      }
      return NextResponse.json({ found: false, room }, { status: 404 });
    } catch {
      return NextResponse.json({ found: false, room }, { status: 404 });
    }
  }

  // 2. 按 id 查询具体回放详情
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
