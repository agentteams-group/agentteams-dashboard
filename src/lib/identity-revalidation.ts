/** SEC-05：Matrix/Console/Controller 身份重验与敏感请求分类。 */
import type { NextRequest } from 'next/server';
import { validateHigressCookieString } from '@/lib/api-auth';
import { orderedCandidates } from '@/lib/backend-config';
import {
  IDENTITY_CACHE_TTL_MS,
  destroySession,
  mapCrLevelToDashLevel,
  type DashboardSession,
  type SessionIdentitySource,
} from '@/lib/dashboard-session';

export type IdentityVerificationResult =
  | { ok: true }
  | { ok: 'invalid'; detail: string }
  | { ok: 'unavailable'; detail: string };

interface HumanIdentity {
  name: string;
  permissionLevel: 1 | 2 | 3;
  teams: string[];
  workers: string[];
}

const PROBE_TIMEOUT_MS = 5000;

function scopeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim()))];
}

function parseHuman(value: unknown): HumanIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const human = value as Record<string, unknown>;
  if (typeof human.name !== 'string' || !human.name) return null;
  if (human.permissionLevel !== 1 && human.permissionLevel !== 2 && human.permissionLevel !== 3) return null;
  const admin = human.permissionLevel === 1;
  return {
    name: human.name,
    permissionLevel: human.permissionLevel,
    teams: admin ? [] : scopeNames(human.accessibleTeams),
    workers: admin ? [] : scopeNames(human.accessibleWorkers),
  };
}

function controllerCandidates(): string[] {
  const configured = orderedCandidates('controller');
  return configured.length > 0 ? configured : ['http://agentteams-controller:8090'];
}

async function probeJson(url: string, token: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // 状态码仍可判定撤销/不可用；畸形成功响应会在 parseHuman 处拒绝。
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

async function verifyMatrix(token: string): Promise<IdentityVerificationResult & { human?: HumanIdentity }> {
  const bases = controllerCandidates();
  let sawUnsupported = false;
  let sawServerFailure = false;
  for (const base of bases) {
    const me = await probeJson(`${base}/api/v1/me`, token);
    if (!me) continue;
    if (me.status === 200) {
      const human = parseHuman(me.body);
      return human ? { ok: true, human } : { ok: 'invalid', detail: 'Controller 返回了无效的 Human 身份' };
    }
    if (me.status === 401 || me.status === 403) {
      return { ok: 'invalid', detail: 'Matrix 凭据无效或已撤销' };
    }
    if (me.status === 404 || me.status === 405) {
      sawUnsupported = true;
      continue;
    }
    sawServerFailure = true;
  }

  if (sawUnsupported) {
    // 旧 Controller 没有 /me：沿用登录时的 own-token status + scope 探针。
    // 无法取得 teams/workers 时保留空范围（拒绝范围化资源），绝不推断全局。
    for (const base of bases) {
      const status = await probeJson(`${base}/api/v1/status`, token);
      if (!status) continue;
      if (status.status === 401 || status.status === 403) {
        return { ok: 'invalid', detail: 'Matrix 凭据无效或已撤销' };
      }
      if (status.status !== 200) {
        sawServerFailure = true;
        continue;
      }
      const [teams, workers] = await Promise.all([
        probeJson(`${base}/api/v1/teams`, token),
        probeJson(`${base}/api/v1/workers`, token),
      ]);
      const teamNames = teams?.status === 200 ? scopeNames((teams.body as { teams?: unknown } | null)?.teams) : [];
      const workerNames = workers?.status === 200 ? scopeNames((workers.body as { workers?: unknown } | null)?.workers) : [];
      return {
        ok: true,
        human: { name: 'user', permissionLevel: 2, teams: teamNames, workers: workerNames },
      };
    }
  }

  return sawServerFailure
    ? { ok: 'unavailable', detail: 'Controller 身份验证暂时不可用' }
    : { ok: 'unavailable', detail: 'Controller 不可达，无法验证身份' };
}

async function verifyConsole(cookie: string | undefined, forceRefresh: boolean): Promise<IdentityVerificationResult> {
  if (!cookie) return { ok: 'unavailable', detail: '旧 Console 会话缺少可重验的服务端凭据，请重新登录' };
  const result = await validateHigressCookieString(cookie, { forceRefresh });
  if (result.valid) return { ok: true };
  if (result.unavailable) return { ok: 'unavailable', detail: 'Console 身份验证暂时不可用' };
  return { ok: 'invalid', detail: 'Console 会话无效或已撤销' };
}

async function verifyControllerToken(token: string): Promise<IdentityVerificationResult> {
  for (const base of controllerCandidates()) {
    const result = await probeJson(`${base}/api/v1/humans?limit=1`, token);
    if (!result) continue;
    if (result.status === 200) return { ok: true };
    if (result.status === 401 || result.status === 403) {
      return { ok: 'invalid', detail: 'Controller 管理员 token 无效或已撤销' };
    }
    if (result.status >= 500 || result.status === 429) {
      return { ok: 'unavailable', detail: 'Controller 身份验证暂时不可用' };
    }
    return { ok: 'invalid', detail: 'Controller 管理员 token 无法验证' };
  }
  return { ok: 'unavailable', detail: 'Controller 不可达，无法验证身份' };
}

function identitySource(session: DashboardSession): SessionIdentitySource {
  if (session.identitySource) return session.identitySource;
  if (session.consoleCookie) return 'console';
  if (session.credential.kind === 'matrix') return 'matrix';
  if (session.credential.kind === 'controller-token') return 'controller-token';
  return 'legacy-sa';
}

function applyHuman(session: DashboardSession, human: HumanIdentity): void {
  session.user = human.name === 'user' ? session.user : human.name;
  session.crLevel = human.permissionLevel;
  session.level = mapCrLevelToDashLevel(human.permissionLevel);
  session.teams = human.teams;
  session.workers = human.workers;
}

/**
 * 非敏感请求复用 30s 身份缓存；敏感请求 forceRefresh=true，每次直达 upstream。
 * 任何网络/配置不可用都 fail closed；明确撤销会销毁服务端 session。
 */
export async function reverifyDashboardSession(
  session: DashboardSession,
  options: { forceRefresh?: boolean } = {},
): Promise<IdentityVerificationResult> {
  const forceRefresh = options.forceRefresh === true;
  const source = identitySource(session);
  if (!forceRefresh && session.identityVerifiedAt && Date.now() - session.identityVerifiedAt < IDENTITY_CACHE_TTL_MS) {
    return { ok: true };
  }

  // 兼容限制：只持有 SA 的旧 Controller L1 会话没有可逐次验证的上游身份。
  // 普通请求保留到最长会话时长；敏感请求必须重新登录/完成管理员验证。
  if (source === 'legacy-sa') {
    return forceRefresh
      ? { ok: 'unavailable', detail: '旧 Controller 会话无法重验身份，请重新登录并完成管理员验证' }
      : { ok: true };
  }

  let result: IdentityVerificationResult;
  let human: HumanIdentity | undefined;
  if (source === 'matrix' && session.credential.kind === 'matrix') {
    const verified = await verifyMatrix(session.credential.token);
    result = verified;
    human = verified.human;
  } else if (source === 'console') {
    result = await verifyConsole(session.consoleCookie, forceRefresh);
  } else if (source === 'controller-token' && session.credential.kind === 'controller-token') {
    result = await verifyControllerToken(session.credential.token);
  } else {
    result = { ok: 'unavailable', detail: '会话身份来源不可验证，请重新登录' };
  }

  if (result.ok !== true) {
    if (result.ok === 'invalid') destroySession(session.sid);
    return result;
  }
  if (human) applyHuman(session, human);
  session.identityVerifiedAt = Date.now();
  return { ok: true };
}

/** 所有写操作、直连存储和 Team/Worker 范围文件都属于身份敏感请求。 */
export function isSensitiveIdentityRequest(request: NextRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') return true;
  const path = request.nextUrl.pathname;
  return (
    path.startsWith('/api/agentteams/storage/') ||
    path.startsWith('/api/agentteams/teams/') ||
    path.startsWith('/api/agentteams/workers/') ||
    path.startsWith('/api/agentteams/workspace-files/') ||
    path.startsWith('/api/agentteams/skills/nacos') ||
    path.startsWith('/api/agentteams/gateway/') ||
    path.startsWith('/api/agentteams/setup/backends') ||
    path.includes('/reset-password') ||
    path.includes('/self-update')
  );
}
