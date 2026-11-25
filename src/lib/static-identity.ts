/**
 * F7 stateless terminal state — static-mode identity resolution.
 *
 * In stateless mode there is no server session: the browser's bearer token IS
 * the credential, and the dashboard must derive the display identity
 * (name / dashboard level / teams) from it for the UI level gate, audit
 * attribution, and the L2 self-scope. The Controller's own per-token RBAC
 * remains the authoritative security boundary on every data call — this
 * resolver only mirrors that decision for the UI.
 *
 * Resolution ladder (per bearer token, cached 5 min):
 *   1. admin-grade token (GET /api/v1/humans list — accepted only for
 *      admin/manager credentials, the same probe login uses)
 *        → { name: 'admin', level: 3 }
 *   2. team-scope matrix token (GET /api/v1/teams 200 + non-empty)
 *        → { name: <whoami localpart>, level: 2, teams: <scoped list> }
 *   3. worker-scope matrix token (GET /api/v1/workers 200 + non-empty)
 *        → { name: <whoami localpart>, level: 1 }
 *   4. controller reachable but the token resolves to nothing
 *        → 'invalid' (definitive: the token is expired/unknown — re-login)
 *
 * Failover semantics mirror the plugin: an AUTH error from a probe is
 * definitive (stop, classify); a NETWORK error walks to the next candidate
 * address. When no controller address is reachable at all → 'unreachable'
 * (the data plane would fail too — the middleware answers 503, not 401).
 *
 * The name comes from the homeserver `whoami` (the same endpoint the plugin
 * uses); when no homeserver is reachable the name degrades to 'user' —
 * identity resolution must not hard-fail on a missing display name.
 */

import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getControllerUrl } from '../app/api/agentteams/proxy-helper';
import { backendAuthHeader, pickBackendUrl } from './backend-config';
import { validateHomeserverUrl, HomeserverValidationError } from './homeserver-allowlist';

export interface StaticIdentity {
  /** Display name (Human CR name / whoami localpart / 'admin'). */
  name: string;
  /** Dashboard rbac level: 3 admin / 2 operator (team) / 1 observer (worker). */
  level: 3 | 2 | 1;
  /** Accessible team names (L2 only; the controller scoped the list). */
  teams: string[];
}

export type StaticIdentityResult =
  | { ok: true; identity: StaticIdentity }
  | { ok: 'invalid'; detail: string }
  | { ok: 'unreachable'; detail: string };

const PROBE_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
  identity: StaticIdentity;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Test hook: drop cached resolutions. */
export function __resetStaticIdentityCacheForTests(): void {
  cache.clear();
}

function cacheKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function probe(
  url: string,
  token: string,
  authHeaders: Record<string, string> = {},
): Promise<{ status: number; json: () => Promise<unknown> } | { networkError: true }> {
  try {
    const res = await fetch(url, {
      // 逐地址覆盖凭据（公网网关 Basic / API key 门）优先于 Bearer：
      // 网关门在前，Bearer 只会被门拒掉。
      headers: { ...authHeaders, Authorization: authHeaders.Authorization ?? `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return {
      status: res.status,
      json: async () => {
        try {
          return await res.json();
        } catch {
          return null;
        }
      },
    };
  } catch {
    return { networkError: true };
  }
}

/** Controller candidate set: the same resolution the proxy layer uses
 * (per-request override > working-first candidates > env > embedded). */
function controllerBaseCandidates(request: NextRequest): string[] {
  const out: string[] = [];
  try {
    out.push(getControllerUrl(request));
  } catch {
    /* no resolvable controller address */
  }
  // Env is a comma-separated candidate list (same convention as the
  // backend-config module).
  for (const env of (process.env.AGENTTEAMS_API_URL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!out.includes(env)) out.push(env);
  }
  if (!out.length) out.push('http://agentteams-controller:8090');
  return out;
}

/**
 * Server-side homeserver candidates (no request context): deployment
 * config + env + in-cluster default. Exported so the /mode route can
 * prefill the first-time stateless login address (the address is a
 * deploy constant — §11.10; NEXT_PUBLIC_* client inlining does not
 * reach container runtime env).
 */
export function serverHomeserverCandidates(): string[] {
  const raw: string[] = [];
  try {
    const configured = pickBackendUrl('matrix');
    if (configured) raw.push(configured);
  } catch {
    /* config not resolvable */
  }
  for (const env of [
    process.env.AGENTTEAMS_MATRIX_URL,
    process.env.NEXT_PUBLIC_MATRIX_API_URL,
  ]) {
    if (env) raw.push(env);
  }
  raw.push('http://agentteams-controller:6167');
  return validateHomeserverCandidates(raw);
}

function validateHomeserverCandidates(raw: string[]): string[] {
  // De-dupe + allowlist (private ranges ARE allowed: a LAN deployment's
  // homeserver is exactly a private address — same as the stateful login).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of raw) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    try {
      // Note: validateHomeserverUrl(allowPrivateNetwork) still rejects the
      // cloud-metadata range (169.254.0.0/16) — a forged header cannot
      // redirect the bearer probe to an instance metadata endpoint.
      validateHomeserverUrl(trimmed, { allowPrivateNetwork: true });
      out.push(trimmed);
    } catch (err) {
      if (err instanceof HomeserverValidationError) continue;
      throw err;
    }
  }
  return out;
}

function homeserverCandidates(request: NextRequest): string[] {
  const raw: string[] = [];
  const headerHs = request.headers.get('x-agentteams-homeserver');
  if (headerHs) raw.push(headerHs);
  raw.push(...serverHomeserverCandidates());
  return validateHomeserverCandidates(raw);
}

/** whoami → localpart, or null (any failure degrades the name to 'user'). */
async function resolveName(
  request: NextRequest,
  token: string,
): Promise<string> {
  for (const homeserver of homeserverCandidates(request)) {
    const result = await probe(
      `${homeserver}/_matrix/client/v3/account/whoami`,
      token,
      backendAuthHeader('matrix', homeserver),
    );
    if ('networkError' in result) continue; // failover: try the next address
    if (result.status === 200) {
      const data = (await result.json()) as { user_id?: string } | null;
      const userId = data?.user_id;
      if (typeof userId === 'string' && userId.startsWith('@')) {
        const localpart = userId.slice(1).split(':')[0];
        if (localpart) return localpart;
      }
    }
    // An auth error is definitive: the token is not valid for this
    // homeserver — no point trying the rest.
    break;
  }
  return 'user';
}

/**
 * Resolve the static-mode identity for the bearer token on `request`.
 * Returns null only when no bearer token is present at all (the caller 401s).
 */
export async function resolveStaticIdentity(
  request: NextRequest,
): Promise<StaticIdentityResult | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim();
  if (!token) return null;

  const key = cacheKey(token);
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) {
    return { ok: true, identity: hit.identity };
  }

  const bases = controllerBaseCandidates(request);
  let allNetworkErrors = true;

  for (const base of bases) {
    const me = await probe(`${base}/api/v1/me`, token);
    if ('networkError' in me) continue;
    allNetworkErrors = false;
    if (me.status === 200) {
      const human = await me.json() as { name?: string; permissionLevel?: number; accessibleTeams?: string[] } | null;
      if (human?.name && (human.permissionLevel === 1 || human.permissionLevel === 2 || human.permissionLevel === 3)) {
        const identity: StaticIdentity = { name: human.name, level: human.permissionLevel === 1 ? 3 : human.permissionLevel === 2 ? 2 : 1, teams: human.accessibleTeams ?? [] };
        remember(key, identity);
        return { ok: true, identity };
      }
      return { ok: 'invalid', detail: 'Controller 返回了无效的 Human 身份' };
    }
    // 1) admin-grade probe (list humans: L2/L3 tokens are 403 by the
    //    authorizer — the same discriminator login uses).
    const humans = await probe(`${base}/api/v1/humans`, token);
    if ('networkError' in humans) continue; // failover to the next controller
    allNetworkErrors = false;

    if (humans.status === 200) {
      const identity: StaticIdentity = { name: 'admin', level: 3, teams: [] };
      remember(key, identity);
      return { ok: true, identity };
    }

    // 2) team-scope (L2): ListTeams is 200 for team humans and returns the
    //    user's OWN accessibleTeams (server-side filtered).
    const teams = await probe(`${base}/api/v1/teams`, token);
    if (!('networkError' in teams) && teams.status === 200) {
      const data = (await teams.json()) as { teams?: { name?: string }[] } | null;
      const names = (data?.teams ?? [])
        .map((t) => t.name ?? '')
        .filter(Boolean);
      if (names.length > 0) {
        const identity: StaticIdentity = { name: await resolveName(request, token), level: 2, teams: names };
        remember(key, identity);
        return { ok: true, identity };
      }
      // 200 but empty: an L2 with no teams yet, or an L3 token for which
      // ListTeams succeeded with an empty scope — fall through to the
      // worker probe below.
    }

    // 3) scope probe. Verified against resource_handler.go (ListTeams /
    //    ListWorkers, RoleHuman scope filters): an L2 with ZERO teams
    //    returns 200+empty on BOTH /teams and /workers (WorkerReadable
    //    scopes to team membership), so a NON-EMPTY /workers list here is
    //    the L3 worker-scope signature (#1220 §2/Q2); an empty list keeps
    //    the (valid) L2 classification with no teams.
    const workers = await probe(`${base}/api/v1/workers`, token);
    if (!('networkError' in workers) && workers.status === 200) {
      const data = (await workers.json()) as { workers?: unknown[] } | null;
      const list = Array.isArray(data?.workers) ? data.workers : [];
      const level: 1 | 2 = list.length > 0 ? 1 : 2;
      const identity: StaticIdentity = {
        name: await resolveName(request, token),
        level,
        teams: [],
      };
      remember(key, identity);
      return { ok: true, identity };
    }

    // Controller answered but the token resolves to no scope on it:
    // definitive (expired / unknown / non-Human matrix account).
    return {
      ok: 'invalid',
      detail: '该凭据在当前 Controller 上无可用权限（token 可能已过期或账号未创建 Human CR）',
    };
  }

  if (allNetworkErrors) {
    return {
      ok: 'unreachable',
      detail: `Controller 全部 ${bases.length} 个地址不可达，无法解析身份`,
    };
  }
  return { ok: 'invalid', detail: '该凭据在当前 Controller 上无可用权限' };
}

function remember(key: string, identity: StaticIdentity): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest-expiring entry (the map is small; linear scan is fine).
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [k, v] of cache) {
      if (v.expiresAt < oldestExpiry) {
        oldestExpiry = v.expiresAt;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { identity, expiresAt: Date.now() + CACHE_TTL_MS });
}
