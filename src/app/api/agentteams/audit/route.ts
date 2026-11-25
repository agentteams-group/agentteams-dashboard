import { NextRequest, NextResponse } from 'next/server';
import { appendAuditEvent, listAuditEvents, type AuditEventInput, type AuditEventRecord, type AuditQuery, type AuditSeverity } from '@/lib/audit-log';
import { normalizeControllerEvents, type NormalizedAuditEvent } from '@/lib/audit-normalize';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';
import { readServerIdentity, enforceLevelOnlyRbac, SERVER_USER_LEVEL_HEADER } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ENTITIES: ReadonlySet<AuditEventInput['entity_type']> = new Set([
  'worker',
  'team',
  'manager',
  'human',
  'system',
]);

const VALID_SEVERITIES: ReadonlySet<AuditSeverity> = new Set(['info', 'warning', 'error']);

function badRequest(message: string): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

/** Level 3+ is admin (sees all events). Level 2+ can audit their own actions. */
function isAuditorLevel(value: string | null): boolean {
  if (!value) return false;
  const level = Number(value);
  return Number.isFinite(level) && level >= 2;
}

/** The controller's audit endpoint caps pages at 200 (upstream #1270). */
const CONTROLLER_LIMIT_CAP = 200;

/**
 * The Controller requires L2 (team-scoped) callers to pass ?team= (400
 * otherwise); cross-team reads are hidden as 404 (anti-probing). When the
 * client did not pick a team, resolve the caller's first accessible team
 * from the Controller's own scoped list — the user's token is already the
 * scope boundary, so this read cannot leak other teams.
 */
async function resolveFirstAccessibleTeam(request: NextRequest): Promise<string | null> {
  try {
    const res = await proxyToAgentTeams(
      request,
      getControllerUrl(request),
      '/api/v1/teams',
      { method: 'GET', forwardBody: false },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { teams?: { name?: string }[] };
    return (data.teams ?? []).map((t) => t.name ?? '').find(Boolean) ?? null;
  } catch {
    return null;
  }
}

/** Local-log fallback (this instance's own JSONL). `note` explains why the
 * controller data plane was not used — the UI surfaces it next to the
 * source badge instead of failing silently. */
async function localAuditResponse(
  query: AuditQuery,
  actorName: string,
  isAdmin: boolean,
  note?: string,
): Promise<NextResponse> {
  if (!isAdmin) {
    // Non-admins can only audit themselves; server enforces the scope so a
    // tampered client cannot bypass by omitting the filter.
    query.actor = actorName;
  }
  const events = await listAuditEvents(query);
  return NextResponse.json({
    success: true,
    source: 'local',
    scope: isAdmin ? 'all' : 'self',
    note,
    events,
  });
}

/**
 * GET /api/agentteams/audit?from=&to=&entityType=&limit=[&team=]
 *
 * Lists recent audit events. Admin (L3+) sees every event; auditors (L2+)
 * are restricted to events they themselves performed so they can review
 * their own actions without seeing other operators' traffic. L1 and below
 * are denied.
 *
 * Data plane (B6): Controller-first — GET /api/v1/audit (upstream #1270)
 * is the durable, cross-entry source (MinIO JSONL, all entry points). When
 * the controller 404s (builds without #1270) or is unreachable (502), the
 * route degrades to this instance's local log with `source: 'local'` and a
 * human-readable `note`; the response always carries `source` so the UI can
 * badge the provenance. L2 on the controller path is team-scoped by the
 * Controller itself (?team= mandatory; team auto-resolved when omitted).
 */
export async function GET(request: NextRequest) {
  const levelHeader = request.headers.get(SERVER_USER_LEVEL_HEADER);
  const observedLevel = levelHeader == null
    ? null
    : (Number.isFinite(Number(levelHeader)) ? Number(levelHeader) : null);

  const identity = readServerIdentity(request);
  if (!identity || !isAuditorLevel(levelHeader)) {
    return NextResponse.json(
      {
        success: false,
        error: '需要审计权限',
        observedLevel,
        requiredLevel: 2,
      },
      { status: 403 },
    );
  }

  // L3+ are platform admins (promoted by the Higress session map); L2 are
  // operators who can audit only their own actions so the dashboard
  // doesn't leak other operators' governance traffic.
  const isAdmin = identity.level >= 3;
  const params = request.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const entityType = params.get('entityType');
  const limitRaw = params.get('limit');
  const teamParam = params.get('team');

  const query: AuditQuery = {};
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
  let filterEntity: AuditEventInput['entity_type'] | null = null;
  if (entityType) {
    if (!ALLOWED_ENTITIES.has(entityType as AuditEventInput['entity_type'])) {
      return badRequest('entityType 非法');
    }
    filterEntity = entityType as AuditEventInput['entity_type'];
    query.entityType = filterEntity; // server-side filter for the local path
  }
  let limit = 200;
  if (limitRaw) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) return badRequest('limit 必须为正整数');
    limit = Math.floor(parsed);
  }

  // ── Controller data plane (durable, cross-entry) ───────────────────
  let effectiveTeam: string | null = null;
  if (isAdmin) {
    effectiveTeam = teamParam; // null = every team + global events
  } else {
    effectiveTeam = teamParam || (await resolveFirstAccessibleTeam(request));
    if (!effectiveTeam) {
      return localAuditResponse(query, identity.name, isAdmin, '无法解析你可访问的团队，显示本实例本地日志');
    }
  }

  const auditQuery = new URLSearchParams();
  if (from) auditQuery.set('from', new Date(Number(from)).toISOString());
  if (to) auditQuery.set('to', new Date(Number(to)).toISOString());
  if (effectiveTeam) auditQuery.set('team', effectiveTeam);
  auditQuery.set('limit', String(Math.min(limit, CONTROLLER_LIMIT_CAP)));

  let res: NextResponse;
  try {
    res = await proxyToAgentTeams(
      request,
      getControllerUrl(request),
      `/api/v1/audit?${auditQuery.toString()}`,
      { method: 'GET', forwardBody: false },
    );
  } catch {
    return localAuditResponse(query, identity.name, isAdmin, 'Controller 审计查询异常，显示本实例本地日志');
  }

  if (res.status === 200) {
    let page: unknown;
    try {
      page = await res.json();
    } catch {
      return localAuditResponse(query, identity.name, isAdmin, 'Controller 审计响应无法解析，显示本实例本地日志');
    }
    const events = normalizeControllerEvents(page);
    if (events === null) {
      return localAuditResponse(query, identity.name, isAdmin, 'Controller 审计响应无法解析，显示本实例本地日志');
    }
    const filtered = filterEntity ? events.filter((e) => e.entity_type === filterEntity) : events;
    return NextResponse.json({
      success: true,
      source: 'controller',
      scope: isAdmin ? 'all' : 'team',
      team: effectiveTeam ?? undefined,
      events: filtered as NormalizedAuditEvent[],
    });
  }

  if (res.status === 404) {
    // Old controller build (no #1270 route) or an L2 team read hidden as
    // 404 (W8 anti-probing) — degrade to the local log either way.
    return localAuditResponse(query, identity.name, isAdmin, 'Controller 版本暂不支持审计查询，显示本实例本地日志');
  }
  if (res.status === 502) {
    return localAuditResponse(query, identity.name, isAdmin, 'Controller 不可达，显示本实例本地日志');
  }

  // Any other upstream status (400 validation, 403 scope, 500/5xx):
  // surface the controller's message rather than silently switching source.
  let detail = `Controller 审计查询失败 (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    if (typeof body.message === 'string' && body.message) detail = body.message;
    else if (typeof body.error === 'string' && body.error) detail = body.error;
  } catch {
    // keep the generic detail
  }
  return NextResponse.json(
    { success: false, source: 'controller', error: detail, upstreamStatus: res.status },
    { status: 502 },
  );
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
  // 审计写入属 admin-grade 操作，L3-only（manage 门）。常规持久化由
  // proxy-helper 集中处理（见 audit-store.ts 注释，客户端不再 POST 镜像），
  // 收紧该端点不影响现有链路。
  const denied = await enforceLevelOnlyRbac(request, 'manage', 'audit', 'write');
  if (denied) return denied;

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
  if (payload.severity !== undefined && !VALID_SEVERITIES.has(payload.severity as AuditSeverity)) {
    return badRequest('severity 非法（仅 info/warning/error）');
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