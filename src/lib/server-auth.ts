/**
 * Server-side authentication helpers used by route handlers under
 * `/api/agentteams/*`. Reads the identity injected by middleware (from the
 * Higress session) and constructs a synthetic `HumanResponse` so the existing
 * `rbac-engine` can evaluate write permissions uniformly.
 *
 * IMPORTANT: `request` here is the *mutated* request that Next.js forwards
 * downstream after the middleware ran. The identity headers were attached by
 * `src/middleware.ts` and must not be read off the original browser request
 * (those would be forgeable).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPermission, checkPermissionByLevel, type Permission } from '@/lib/rbac-engine';
import type { HumanResponse } from '@/lib/agentteams-api';
import { appendAuditEvent } from '@/lib/audit-log';
import { getSessionFromRequest, sessionHasGlobalScope } from '@/lib/dashboard-session';
import { isStatelessAuthMode } from '@/lib/static-mode';
import { normalizeStorageKey } from '@/lib/sensitive-files';

export const SERVER_USER_HEADER = 'x-agentteams-user';
export const SERVER_USER_LEVEL_HEADER = 'x-agentteams-user-level';
export const SERVER_USER_TEAMS_HEADER = 'x-agentteams-teams';
export const SERVER_USER_WORKERS_HEADER = 'x-agentteams-workers';
export const SERVER_USER_SCOPE_HEADER = 'x-agentteams-scope';
export const SERVER_USER_IP_HEADER = 'x-forwarded-for';

/**
 * SEC-10: `x-forwarded-for` is only honored when the deployment explicitly
 * declares a trusted reverse proxy (AGENTTEAMS_TRUST_PROXY=true). On a
 * directly-exposed dashboard any client could otherwise forge the
 * `source_ip` recorded in audit events.
 */
function resolveAuditSourceIp(request: NextRequest): string | undefined {
  if (process.env.AGENTTEAMS_TRUST_PROXY !== 'true') return undefined;
  const forwarded = request.headers.get(SERVER_USER_IP_HEADER);
  return forwarded ? forwarded.split(',')[0]?.trim() : undefined;
}

export interface ServerIdentity {
  name: string;
  level: number;
  /** undefined=未知范围；[]=明确无范围；两者都不得按全局放行。 */
  teams?: string[];
  workers?: string[];
  scope: 'global' | 'scoped' | 'unknown';
  sourceIp?: string;
}

function parseScopeHeader(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 256 || parsed.some((item) => typeof item !== 'string')) return undefined;
    return [...new Set(parsed.map((item) => item.trim()).filter(Boolean))];
  } catch {
    return undefined;
  }
}

export function readServerIdentity(request: NextRequest): ServerIdentity | null {
  const sourceIp = resolveAuditSourceIp(request);
  // 有签名 session 时以服务端 store 为最高可信来源，避免直连 route 时覆盖范围。
  // stateless / auth-disabled 没有 session，消费 middleware 覆盖后的可信头。
  if (!isStatelessAuthMode() && process.env.AGENTTEAMS_AUTH_DISABLED !== 'true') {
    const session = getSessionFromRequest(request);
    if (session) {
      return {
        name: session.user,
        level: session.level,
        teams: session.teams,
        workers: session.workers,
        scope: sessionHasGlobalScope(session) ? 'global' : 'scoped',
        sourceIp,
      };
    }
  }

  const name = request.headers.get(SERVER_USER_HEADER)?.trim();
  if (!name) return null;
  const levelRaw = request.headers.get(SERVER_USER_LEVEL_HEADER);
  const level = levelRaw ? Number(levelRaw) : 1;
  const normalizedLevel = Number.isFinite(level) ? level : 1;
  const scopeRaw = request.headers.get(SERVER_USER_SCOPE_HEADER);
  const scope = scopeRaw === 'global' && normalizedLevel === 3
    ? 'global'
    : scopeRaw === 'scoped' ? 'scoped' : 'unknown';
  return {
    name,
    level: normalizedLevel,
    teams: parseScopeHeader(request.headers.get(SERVER_USER_TEAMS_HEADER)),
    workers: parseScopeHeader(request.headers.get(SERVER_USER_WORKERS_HEADER)),
    scope,
    sourceIp,
  };
}

export function buildHuman(identity: ServerIdentity): HumanResponse {
  return {
    name: identity.name,
    permissionLevel: identity.level,
    systemAdmin: identity.scope === 'global' && identity.level === 3,
    accessibleTeams: identity.teams,
    accessibleWorkers: identity.workers,
  } as HumanResponse;
}

export interface RbacEnforcementInput {
  identity: ServerIdentity;
  action: Permission;
  resourceType: 'worker' | 'team';
  resourceName: string;
}

export interface RbacEnforcementResult {
  allowed: boolean;
  reason: string;
}

/**
 * Evaluate server-side RBAC for a write request. Returns `{ allowed: false,
 * reason }` when the active session lacks the permission; route handlers
 * should turn this into a 403 response. On deny, an audit event is appended
 * with severity=warning for forensic traceability.
 */
export function evaluateServerSideRbac(input: RbacEnforcementInput): RbacEnforcementResult {
  const human = buildHuman(input.identity);
  const result = checkPermission(human, input.action, input.resourceType, input.resourceName);
  if (!result.allowed) {
    void appendAuditEvent({
      actor: input.identity.name,
      actor_level: input.identity.level,
      entity_type: input.resourceType === 'worker' ? 'worker' : 'team',
      entity_name: input.resourceName,
      action: `rbac.deny.${input.action}`,
      details: result.reason,
      severity: 'warning',
      source_ip: input.identity.sourceIp,
    });
  }
  return result;
}

/**
 * Convenience wrapper for route handlers: when RBAC denies, returns a 403
 * `NextResponse`; otherwise returns `null` so the handler can proceed.
 *
 * 缺失身份一律 401；未知/空范围由 rbac-engine 拒绝。route handler 直连
 * 调用也保持 fail closed，不依赖 middleware 作为唯一授权边界。
 */
export async function enforceServerSideRbac(
  request: NextRequest,
  action: Permission,
  resourceType: 'worker' | 'team',
  resourceName: string,
): Promise<NextResponse | null> {
  // 纵深防御：dashboard 等级门与 Controller 原生 per-token RBAC 并行生效。
  // 直连 MinIO 的路由没有 Controller 兜底，必须自行执行资源级授权。
  const identity = readServerIdentity(request);
  if (!identity) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const result = evaluateServerSideRbac({ identity, action, resourceType, resourceName });
  if (result.allowed) return null;
  return NextResponse.json(
    { success: false, error: result.reason, action, resourceType, resourceName },
    { status: 403 },
  );
}

export type StorageResourceScope =
  | { kind: 'worker' | 'team'; name: string }
  | { kind: 'collection'; resourceType: 'worker' | 'team' }
  | null;

/** 从规范化对象 key 提取 Team/Worker 资源范围。 */
export function getStorageResourceScope(key: string): StorageResourceScope {
  let normalized: string;
  try {
    normalized = normalizeStorageKey(key);
  } catch {
    // 非法 key 由调用方按敏感对象拒绝，不能在这里降级为无范围。
    return { kind: 'collection', resourceType: 'worker' };
  }
  const [root, name] = normalized.split('/');
  if ((root === 'workers' || root === 'agents') && name) return { kind: 'worker', name };
  if (root === 'workers' || root === 'agents') return { kind: 'collection', resourceType: 'worker' };
  if (root === 'teams' && name) return { kind: 'team', name };
  if (root === 'teams') return { kind: 'collection', resourceType: 'team' };
  return null;
}

/**
 * 通用存储对象的资源级 RBAC。集合列表仅允许全局身份；具名对象按
 * workers/agents/teams 前缀执行范围校验，其他前缀沿用全局等级检查。
 */
export async function enforceStorageObjectRbac(
  request: NextRequest,
  action: Permission,
  key: string,
): Promise<NextResponse | null> {
  const scope = getStorageResourceScope(key);
  if (scope?.kind === 'collection') {
    const identity = readServerIdentity(request);
    if (!identity) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (identity.scope !== 'global' || identity.level !== 3) {
      return NextResponse.json(
        { success: false, error: 'Scoped identity cannot list the worker/team collection', action, resourceName: key },
        { status: 403 },
      );
    }
    return null;
  }
  if (scope?.kind === 'worker' || scope?.kind === 'team') {
    return enforceServerSideRbac(request, action, scope.kind, scope.name);
  }
  return enforceLevelOnlyRbac(request, action, 'storage', key);
}

/** list 结果逐项过滤，避免具名范围通过通配前缀看到其他资源。 */
export function filterStorageKeysForIdentity<T>(
  request: NextRequest,
  action: Permission,
  keys: T[],
  getKey: (_item: T) => string,
): T[] {
  const identity = readServerIdentity(request);
  if (!identity || identity.scope === 'unknown') return [];
  if (identity.scope === 'global' && identity.level === 3) return keys;
  return keys.filter((item) => {
    const scope = getStorageResourceScope(getKey(item));
    if (!scope) return false;
    if (scope.kind === 'collection') return false;
    return evaluateServerSideRbac({ identity, action, resourceType: scope.kind, resourceName: scope.name }).allowed;
  });
}

/**
 * Level-only RBAC check for global resources (storage, skill catalog,
 * gateway routes, etc.) that are not partitioned per-team / per-worker.
 * Bypasses the resource-scoping logic in `rbac-engine` and answers only
 * whether the permission level grants the requested action. Mirrors
 * `enforceServerSideRbac` semantics for the no-identity path.
 */
export async function enforceLevelOnlyRbac(
  request: NextRequest,
  action: Permission,
  resourceType: string,
  resourceName: string,
): Promise<NextResponse | null> {
  // 纵深防御：与 enforceServerSideRbac 相同——dashboard 等级门与
  // Controller 原生 per-token RBAC 并行生效；直连 MinIO 的路由没有
  // Controller 兜底，stateless 模式下也照常执行等级检查。
  const identity = readServerIdentity(request);
  if (!identity) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (checkPermissionByLevel(identity.level, action)) return null;
  await appendAuditEvent({
    actor: identity.name,
    actor_level: identity.level,
    entity_type: 'system',
    entity_name: resourceName,
    action: `rbac.deny.${action}`,
    details: `权限等级 ${identity.level} 不允许 "${action}" ${resourceType} 操作`,
    severity: 'warning',
    source_ip: identity.sourceIp,
  });
  return NextResponse.json(
    {
      success: false,
      error: `权限等级 ${identity.level} 不允许 "${action}" ${resourceType} 操作`,
      action,
      resourceType,
      resourceName,
    },
    { status: 403 },
  );
}