import { NextRequest, NextResponse } from 'next/server';
import { appendAuditEvent, listAuditEvents, type AuditEventInput, type AuditEventRecord } from '@/lib/audit-log';
import { readServerIdentity, SERVER_USER_LEVEL_HEADER } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ENTITIES: ReadonlySet<AuditEventInput['entity_type']> = new Set([
  'worker',
  'team',
  'manager',
  'human',
  'system',
]);

function badRequest(message: string): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

function isAdminLevel(value: string | null): boolean {
  if (!value) return false;
  const level = Number(value);
  return Number.isFinite(level) && level >= 3;
}

/**
 * GET /api/agentteams/audit?from=&to=&entityType=&limit=
 *
 * Lists recent audit events. Admin-only — the dashboard is the canonical
 * viewer for this data, and downstream operator personas are at level 3.
 */
export async function GET(request: NextRequest) {
  if (!isAdminLevel(request.headers.get(SERVER_USER_LEVEL_HEADER))) {
    return NextResponse.json({ success: false, error: '需要管理员权限' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const entityType = params.get('entityType');
  const limitRaw = params.get('limit');

  const query: Parameters<typeof listAuditEvents>[0] = {};
  if (from) {
    const ts = Number(from);
    if (!Number.isFinite(ts)) return badRequest('from 不是合法时间戳');
    query.from = ts;
  }
  if (to) {
    const ts = Number(to);
    if (!Number.isFinite(ts)) return badRequest('to 不是合法时间戳');
    query.to = ts;
  }
  if (entityType) {
    if (!ALLOWED_ENTITIES.has(entityType as AuditEventInput['entity_type'])) {
      return badRequest('entityType 非法');
    }
    query.entityType = entityType as AuditEventInput['entity_type'];
  }
  if (limitRaw) {
    const limit = Number(limitRaw);
    if (!Number.isFinite(limit) || limit <= 0) return badRequest('limit 必须为正整数');
    query.limit = limit;
  }

  const events = await listAuditEvents(query);
  return NextResponse.json({ success: true, events });
}

/**
 * POST /api/agentteams/audit
 *
 * Internal write path used by the mutation flow to record governance events
 * on the server. The identity is taken from middleware-injected headers
 * (forgery-resistant). Body fields that conflict with the resolved identity
 * are overwritten server-side so a malicious client cannot impersonate.
 */
export async function POST(request: NextRequest) {
  const identity = readServerIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { success: false, error: '无身份头，禁止写入审计' },
      { status: 403 },
    );
  }

  let payload: Partial<AuditEventInput> & { severity?: AuditEventInput['severity'] };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return badRequest('请求体不是合法 JSON');
  }

  if (!payload || typeof payload !== 'object') return badRequest('请求体必须为对象');
  if (typeof payload.entity_type !== 'string' || !ALLOWED_ENTITIES.has(payload.entity_type as AuditEventInput['entity_type'])) {
    return badRequest('entity_type 非法');
  }
  if (typeof payload.entity_name !== 'string' || payload.entity_name.length === 0) {
    return badRequest('entity_name 必填');
  }
  if (typeof payload.action !== 'string' || payload.action.length === 0) {
    return badRequest('action 必填');
  }

  const record: AuditEventRecord | undefined = await appendAuditEvent({
    actor: identity.name,
    actor_level: identity.level,
    entity_type: payload.entity_type as AuditEventInput['entity_type'],
    entity_name: payload.entity_name,
    action: payload.action,
    details: typeof payload.details === 'string' ? payload.details : undefined,
    severity: payload.severity,
    source_ip: identity.sourceIp,
  });

  if (!record) {
    return NextResponse.json({ success: false, error: '审计写入失败' }, { status: 500 });
  }
  return NextResponse.json({ success: true, id: record.id });
}