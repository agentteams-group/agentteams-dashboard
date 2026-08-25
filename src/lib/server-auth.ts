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

export const SERVER_USER_HEADER = 'x-agentteams-user';
export const SERVER_USER_LEVEL_HEADER = 'x-agentteams-user-level';
export const SERVER_USER_IP_HEADER = 'x-forwarded-for';

export interface ServerIdentity {
  name: string;
  level: number;
  sourceIp?: string;
}

export function readServerIdentity(request: NextRequest): ServerIdentity | null {
  const name = request.headers.get(SERVER_USER_HEADER);
  if (!name) return null;
  const levelRaw = request.headers.get(SERVER_USER_LEVEL_HEADER);
  const level = levelRaw ? Number(levelRaw) : 1;
  const forwarded = request.headers.get(SERVER_USER_IP_HEADER);
  const sourceIp = forwarded ? forwarded.split(',')[0]?.trim() : undefined;
  return {
    name,
    level: Number.isFinite(level) ? level : 1,
    sourceIp,
  };
}

function buildHuman(identity: ServerIdentity): HumanResponse {
  return {
    name: identity.name,
    permissionLevel: identity.level,
    // RBAC scoping fields default to undefined so the engine treats the user
    // as having global access within their permission level. Per-team /
    // per-worker restrictions are configured in the Controller side.
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
 * If the request carries no server-injected identity (test paths,
 * `AGENTTEAMS_AUTH_DISABLED=true`, or any code path that bypassed
 * middleware) the function returns `null` so the handler can proceed —
 * the middleware gate at the network edge remains the authoritative
 * authentication check. This keeps the function side-effect-free for
 * callers that do not yet wire identity headers.
 */
export async function enforceServerSideRbac(
  request: NextRequest,
  action: Permission,
  resourceType: 'worker' | 'team',
  resourceName: string,
): Promise<NextResponse | null> {
  const identity = readServerIdentity(request);
  if (!identity) return null;
  const result = evaluateServerSideRbac({ identity, action, resourceType, resourceName });
  if (result.allowed) return null;
  return NextResponse.json(
    { success: false, error: result.reason, action, resourceType, resourceName },
    { status: 403 },
  );
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
  const identity = readServerIdentity(request);
  if (!identity) return null;
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