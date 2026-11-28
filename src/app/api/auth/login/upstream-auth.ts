import type { NextRequest } from 'next/server';
import { callHigressConsole } from '../../higress/proxy-helper';
import { getAuthToken, getControllerUrl } from '../../agentteams/proxy-helper';
import { backendAuthHeader, orderedCandidates, pickBackendUrl } from '@/lib/backend-config';
import { validateHomeserverUrl } from '@/lib/homeserver-allowlist';

// Matrix homeserver for password login — resolved PER LOGIN ATTEMPT
// (post-merge review Block 1): saved config (setup page) > env > embedded
// co-located default (the dashboard container reaches Tuwunel directly
// inside the agentteams-controller container). The module-level constant
// this replaced ignored the saved config, so a standalone deployment with
// Matrix elsewhere always hit the in-cluster address and the Matrix track
// silently died.
function resolveMatrixHomeserver(): string {
  return (
    pickBackendUrl('matrix') ||
    process.env.NEXT_PUBLIC_MATRIX_API_URL ||
    process.env.AGENTTEAMS_MATRIX_URL ||
    'http://agentteams-controller:6167'
  );
}

export interface HumanRecord {
  name?: string;
  permissionLevel?: number;
  accessibleTeams?: string[];
  accessibleWorkers?: string[];
}

export function controllerProbeTargets(request: NextRequest): string[] {
  const out: string[] = [];
  const add = (url: string | undefined) => {
    const value = url?.trim();
    if (value && !out.includes(value)) out.push(value);
  };
  add(getControllerUrl(request));
  for (const candidate of orderedCandidates('controller')) add(candidate);
  return out;
}

export type MeResult =
  | { kind: 'human'; human: HumanRecord }
  | { kind: 'rejected' } // 401/403: the token is not a valid Human identity
  | { kind: 'unsupported' }; // 404/405: this Controller predates /api/v1/me (legacy)

/**
 * Resolve the caller using only their own token (#214 semantics — the server
 * SA token is never involved here). Distinguishes a rejected identity
 * (401/403) from a Controller that lacks /api/v1/me entirely (404/405 → the
 * pre-1.4 legacy fallback); a network failure walks the remaining candidates
 * and throws only when none of them can answer.
 */
export async function fetchCurrentHuman(request: NextRequest, token: string): Promise<MeResult> {
  for (const base of controllerProbeTargets(request)) {
    try {
      const res = await fetch(`${base}/api/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      if (res.status === 200) return { kind: 'human', human: (await res.json()) as HumanRecord };
      if (res.status === 401 || res.status === 403) return { kind: 'rejected' };
      if (res.status === 404 || res.status === 405) return { kind: 'unsupported' };
      // Any other status: this candidate is up but not helpful — walk on.
    } catch { /* try the next configured Controller */ }
  }
  throw new Error('Controller unavailable or missing /api/v1/me support');
}

/** A HumanRecord the legacy fallback can build a session from. */
export function isUsableHuman(human: HumanRecord): boolean {
  return (
    typeof human.name === 'string' &&
    human.name.length > 0 &&
    (human.permissionLevel === 1 || human.permissionLevel === 2 || human.permissionLevel === 3)
  );
}

/**
 * Legacy identity lookup with the server-side SA token (pre-#214 channel):
 * GET /api/v1/humans/{localpart}. Returns null when no SA credential is
 * configured, the Controller rejects it, or no Human CR exists.
 */
export async function fetchHumanViaSa(request: NextRequest, localpart: string): Promise<HumanRecord | null> {
  const token = await getAuthToken();
  if (!token) return null;
  for (const base of controllerProbeTargets(request)) {
    try {
      const res = await fetch(`${base}/api/v1/humans/${encodeURIComponent(localpart)}`, {
        // Per-address door credential may replace the SA bearer (same policy
        // as the data plane's treatment of 'sa' session credentials).
        headers: { Authorization: `Bearer ${token}`, ...backendAuthHeader('controller', base) },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      // Any HTTP answer is definitive for this address (proxy-layer
      // semantics); only a transport error walks to the next candidate.
      if (res.ok) return (await res.json()) as HumanRecord;
      return null;
    } catch { /* unreachable candidate: try the next address */ }
  }
  return null;
}

export type LegacyOwnTokenProbe =
  | { kind: 'l2'; teams: string[]; workers: string[] }
  | { kind: 'rejected' } // the Controller answered: this token is not L2
  | { kind: 'unavailable' }; // every candidate was unreachable

/**
 * Legacy L2 probe (pre-#214, plugin model): the old Controller's Matrix auth
 * accepts only permissionLevel=2 tokens, so a 200 on GET /api/v1/status with
 * the user's own token proves team-user identity WITHOUT reading the Human
 * CR. GET /api/v1/teams is server-side filtered to the caller's own scope.
 */
export async function probeLegacyOwnToken(request: NextRequest, token: string): Promise<LegacyOwnTokenProbe> {
  for (const base of controllerProbeTargets(request)) {
    let statusRes: Response;
    try {
      statusRes = await fetch(`${base}/api/v1/status`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
    } catch {
      continue; // unreachable candidate: try the next address
    }
    if (!statusRes.ok) return { kind: 'rejected' };
    let teams: string[] = [];
    let workers: string[] = [];
    try {
      const teamsRes = await fetch(`${base}/api/v1/teams`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      if (teamsRes.ok) {
        const data = (await teamsRes.json()) as { teams?: { name?: string }[] };
        teams = (data.teams ?? []).map((t) => t.name ?? '').filter(Boolean);
      }
    } catch { /* 空范围将 fail closed，绝不能推断为全局 */ }
    try {
      const workersRes = await fetch(`${base}/api/v1/workers`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      if (workersRes.ok) {
        const data = (await workersRes.json()) as { workers?: { name?: string }[] };
        workers = (data.workers ?? []).map((worker) => worker.name ?? '').filter(Boolean);
      }
    } catch { /* 旧 Controller 不返回 Worker 范围时，Worker 文件路由默认拒绝 */ }
    return { kind: 'l2', teams, workers };
  }
  return { kind: 'unavailable' };
}

export type MatrixLoginResult =
  | { kind: 'ok'; data: Record<string, unknown> }
  | { kind: 'invalid'; detail: string } // 401/403 only — the credentials are wrong
  | { kind: 'unavailable'; detail: string }; // timeout / network / 429 / 5xx

// Logins are human-paced; a 5s timeout is too tight for a multi-node
// homeserver under load, and a timeout must never be reported as a bad
// password.
const MATRIX_LOGIN_TIMEOUT_MS = 8_000;
export const LOGIN_RETRY_DELAY_MS = 300;

/** The log-safe upstream identity: host only, never the full URL. */
export function upstreamHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One Matrix password-login round trip (retry/backoff is the caller's job). */
async function matrixLoginAttempt(
  username: string,
  password: string,
  homeserver: string,
  attempt: number,
): Promise<MatrixLoginResult> {
  const host = upstreamHost(homeserver);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${homeserver}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...backendAuthHeader('matrix', homeserver) },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
      }),
      signal: AbortSignal.timeout(MATRIX_LOGIN_TIMEOUT_MS),
    });
    const elapsed = Date.now() - startedAt;
    if (res.ok) {
      const data = await res.json();
      console.warn(`[auth/login] matrix attempt ${attempt} ${host} HTTP ${res.status} (${elapsed}ms) -> ok`);
      return {
        kind: 'ok',
        data: {
          accessToken: data.access_token,
          userId: data.user_id,
          deviceId: data.device_id,
          homeserver,
        },
      };
    }
    if (res.status === 401 || res.status === 403) {
      console.warn(`[auth/login] matrix attempt ${attempt} ${host} HTTP ${res.status} (${elapsed}ms) -> invalid`);
      return { kind: 'invalid', detail: `HTTP ${res.status}` };
    }
    // 429 / 5xx (and anything else non-2xx): the homeserver is reachable but
    // cannot answer right now — transient, never a credential verdict.
    console.warn(`[auth/login] matrix attempt ${attempt} ${host} HTTP ${res.status} (${elapsed}ms) -> transient`);
    return { kind: 'unavailable', detail: `HTTP ${res.status}` };
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[auth/login] matrix attempt ${attempt} ${host} ${detail} (${Date.now() - startedAt}ms) -> transient`);
    return { kind: 'unavailable', detail };
  }
}

/**
 * Attempt Matrix login with the given credentials.
 * Only 401/403 mean "wrong credentials". Timeouts, network errors, 429 and
 * 5xx are transient: retried once, and reported as 503 by the caller so a
 * temporarily unavailable homeserver is never presented as a bad password.
 */
export async function tryMatrixLogin(username: string, password: string): Promise<MatrixLoginResult> {
  const homeserver = resolveMatrixHomeserver();
  try {
    validateHomeserverUrl(homeserver, { allowPrivateNetwork: true });
  } catch {
    // Deployment configuration gap, not a credential problem — never 401.
    console.error(`[auth/login] matrix homeserver rejected by the allowlist: ${upstreamHost(homeserver)}`);
    return { kind: 'unavailable', detail: 'invalid homeserver url' };
  }

  const first = await matrixLoginAttempt(username, password, homeserver, 1);
  if (first.kind !== 'unavailable') return first;
  await sleep(LOGIN_RETRY_DELAY_MS);
  return matrixLoginAttempt(username, password, homeserver, 2);
}

export type ConsoleLoginCall =
  | { kind: 'ok'; response: Response }
  | { kind: 'rejected'; status: number }
  | { kind: 'transient'; detail: string };

/**
 * One Console /session/login round trip. Only 401/403 are credential
 * rejections; timeouts, network errors, 429 and 5xx are transient so they can
 * be retried and never collapse into "wrong password".
 */
export async function consoleLoginAttempt(
  username: string,
  password: string,
  host: string,
  attempt: number,
): Promise<ConsoleLoginCall> {
  const startedAt = Date.now();
  try {
    // No consoleUrl option: callHigressConsole resolves the same shared URL
    // (getHigressConsoleURL).
    const { response } = await callHigressConsole('/session/login', {
      method: 'POST',
      body: { username, password },
    });
    const elapsed = Date.now() - startedAt;
    if (response.ok) {
      console.warn(`[auth/login] console attempt ${attempt} ${host} HTTP ${response.status} (${elapsed}ms) -> ok`);
      return { kind: 'ok', response };
    }
    if (response.status === 401 || response.status === 403) {
      console.warn(`[auth/login] console attempt ${attempt} ${host} HTTP ${response.status} (${elapsed}ms) -> invalid`);
      return { kind: 'rejected', status: response.status };
    }
    if (response.status === 429 || response.status >= 500) {
      console.warn(`[auth/login] console attempt ${attempt} ${host} HTTP ${response.status} (${elapsed}ms) -> transient`);
      return { kind: 'transient', detail: `HTTP ${response.status}` };
    }
    // Other 4xx (e.g. a 404 from a misrouted Console) is not retryable, but
    // it is not a wrong password either — surface it as a track failure.
    console.warn(`[auth/login] console attempt ${attempt} ${host} HTTP ${response.status} (${elapsed}ms) -> failed`);
    return { kind: 'rejected', status: response.status };
  } catch (err) {
    // F1g: surface the failure in docker logs. A silently-failing Console
    // track sends admin-password users down the Matrix track into the
    // confusing "paste a Controller token" error with no trace of WHY the
    // password path died (install-verify 9/9: only the token worked).
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[auth/login] console attempt ${attempt} ${host} ${detail} (${Date.now() - startedAt}ms) -> transient`);
    return { kind: 'transient', detail };
  }
}

export async function verifyControllerToken(request: NextRequest, token: string): Promise<boolean> {
  for (const url of controllerProbeTargets(request)) {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/api/v1/humans?limit=1`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      // 200 = admin-grade proof. 401/403 (and any other non-2xx) just means
      // this candidate cannot verify the token — try the next one.
      if (res.ok) return true;
    } catch {
      // Unreachable candidate: continue with the next address.
    }
  }
  return false;
}

/**
 * Verify the deployment admin's Console credentials (adminUsername +
 * adminPassword) against the Console session endpoint. Returns the accepted
 * response so the caller can bind the Console session server-side
 * (collectSetCookieHeader) — it is never forwarded to the browser.
 * Reuses callHigressConsole: no parallel Console client, no logging of the
 * credentials.
 */
export async function verifyAdminConsoleCredentials(
  username: string,
  password: string,
): Promise<{ response: Response } | null> {
  try {
    const { response } = await callHigressConsole('/session/login', {
      method: 'POST',
      body: { username, password },
    });
    return response.ok ? { response } : null;
  } catch {
    return null;
  }
}
