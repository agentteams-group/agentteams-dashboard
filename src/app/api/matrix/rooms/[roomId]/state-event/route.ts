// POST /api/matrix/rooms/[roomId]/state-event - Write a namespaced room state event.
//
// 自定义状态事件写通道（PRD F3.3/F3.4 / §8.3 存储选择）：放行记录
// （com.agentteams.release）、空间配置（com.agentteams.space）等协作资产
// 以 Matrix 房间状态事件承载 —— Stateless 兼容（零服务端存储域）。
// 仅允许 `com.agentteams.` 前缀的事件类型（防滥用与仿冒核心事件类型），
// 写动作落 release.* / space.* 审计事件以便审计页归因。
import { NextRequest, NextResponse } from 'next/server';
import { HomeserverValidationError } from '@/lib/homeserver-allowlist';
import { appendAuditEvent } from '@/lib/audit-log';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import {
  getMatrixHomeserver,
  getAccessToken,
  proxyToMatrix,
} from '../../../proxy-helper';

const ALLOWED_EVENT_PREFIX = 'com.agentteams.';

function isRoomId(value: string): boolean {
  return (
    /^![A-Za-z0-9._=\/+-]+:[A-Za-z0-9.-]+(?::\d+)?$/.test(value) ||
    /^#[A-Za-z0-9._-]+:[A-Za-z0-9.-]+$/.test(value)
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  let homeserver: string;
  let accessToken: string;
  let roomId: string;
  try {
    roomId = (await params).roomId;
    if (!isRoomId(roomId)) {
      return NextResponse.json({ errcode: 'M_INVALID_ROOM_ID', error: 'invalid room id' }, { status: 400 });
    }
    homeserver = getMatrixHomeserver(request);
    accessToken = getAccessToken(request);
  } catch (err) {
    if (err instanceof HomeserverValidationError) {
      return NextResponse.json({ errcode: 'M_FORBIDDEN', error: err.reason }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let eventType: string;
  let stateKey: string;
  let content: Record<string, unknown>;
  try {
    const body = await request.json();
    eventType = typeof body.eventType === 'string' ? body.eventType : '';
    stateKey = typeof body.stateKey === 'string' && body.stateKey.length > 0 ? body.stateKey : '';
    content = body.content && typeof body.content === 'object' && !Array.isArray(body.content)
      ? body.content
      : null!;
    if (!eventType || !content) {
      return NextResponse.json({ error: 'Missing eventType or content' }, { status: 400 });
    }
    if (!eventType.startsWith(ALLOWED_EVENT_PREFIX)) {
      return NextResponse.json(
        { error: `eventType must be namespaced under ${ALLOWED_EVENT_PREFIX}*` },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 审计归因（与 matrix.invite.accept 同模式）：优先 dashboard session 身份，
  // 回退 Matrix token 身份。
  let actor = 'unknown';
  let actorLevel: number | undefined;
  try {
    const session = await getSessionFromRequest(request);
    if (session?.user) {
      actor = session.user;
      actorLevel = session.level;
    }
  } catch {
    /* stateless: token identity is embedded in the record content by the caller */
  }
  if (actor === 'unknown' && typeof content.actor === 'string') {
    actor = content.actor;
  }

  const encodedRoomId = encodeURIComponent(roomId);
  const encodedType = encodeURIComponent(eventType);
  const encodedKey = encodeURIComponent(stateKey);
  const path = `/_matrix/client/v3/rooms/${encodedRoomId}/state/${encodedType}/${encodedKey}`;

  // proxyToMatrix forwards the incoming request body verbatim; swap in the
  // bare event content (the client body wraps it with eventType/stateKey).
  const forwardRequest = new NextRequest(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: JSON.stringify(content),
  });
  const response = await proxyToMatrix(forwardRequest, homeserver, path, accessToken, {
    method: 'PUT',
  });

  if (response.ok) {
    const action =
      typeof content.action === 'string' ? content.action : 'update';
    await appendAuditEvent({
      actor,
      actor_level: actorLevel,
      entity_type: 'system',
      entity_name: typeof content.project_id === 'string' ? content.project_id : roomId,
      action: `release.${action}`,
      details: JSON.stringify({
        eventType,
        stateKey,
        task_id: content.task_id,
        round: content.round,
        auto_release: content.auto_release,
      }),
      severity: 'info',
    });
  }

  return response;
}
