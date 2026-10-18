// POST /api/agentteams/hitl/audit - Record HITL lifecycle audit events.
//
// 干预回路审计落点（PRD F2.4）：hitl.request（收件箱 ingest 新干预）、
// hitl.answer（用户提交答复：所选答案与耗时）、hitl.expire（超时升级）。
// 事件类型白名单校验，actor 取 dashboard session（归因与 matrix.invite.accept
// 同模式）；entity 以 confirmation_id 标识，details 携带任务/答案/耗时。
import { NextRequest, NextResponse } from 'next/server';
import { appendAuditEvent } from '@/lib/audit-log';
import { getSessionFromRequest } from '@/lib/dashboard-session';

const ALLOWED_ACTIONS = new Set(['request', 'answer', 'expire']);

export async function POST(request: NextRequest) {
  let actor = 'unknown';
  let actorLevel: number | undefined;
  try {
    const session = await getSessionFromRequest(request);
    if (session?.user) {
      actor = session.user;
      actorLevel = session.level;
    }
  } catch {
    /* stateless: identity falls back to the caller-provided actor */
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const confirmationId = typeof body.confirmation_id === 'string' ? body.confirmation_id : '';
  if (!ALLOWED_ACTIONS.has(action) || !confirmationId) {
    return NextResponse.json(
      { error: `action must be one of ${[...ALLOWED_ACTIONS].join('/')} and confirmation_id is required` },
      { status: 400 },
    );
  }

  if (actor === 'unknown' && typeof body.actor === 'string' && body.actor.length > 0) {
    actor = body.actor;
  }

  const details: Record<string, unknown> = {
    confirmation_id: confirmationId,
  };
  if (typeof body.room_id === 'string') details.room_id = body.room_id;
  if (typeof body.tool_name === 'string') details.tool_name = body.tool_name;
  if (typeof body.question === 'string') details.question = body.question;
  if (typeof body.answer === 'string') details.answer = body.answer;
  if (typeof body.elapsed_ms === 'number') details.elapsed_ms = body.elapsed_ms;

  await appendAuditEvent({
    actor,
    actor_level: actorLevel,
    entity_type: 'system',
    entity_name: confirmationId,
    action: `hitl.${action}`,
    details: JSON.stringify(details),
    severity: action === 'expire' ? 'warning' : 'info',
  });

  return NextResponse.json({ ok: true });
}
