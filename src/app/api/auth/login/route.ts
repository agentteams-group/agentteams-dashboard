// POST /api/auth/login — dual-track login (embedded/default mode):
//   1. Console admin account (Higress Console /session/login) — the Console
//      admin has no Human CR; success returns a level-3 'sa' session.
//   2. Matrix Human account — Matrix password login → own token →
//      GET /api/v1/me (modern Controllers, #214 own-token semantics). On a
//      pre-1.4 Controller without /me (404/405) the legacy fallback runs:
//      SA GET /api/v1/humans/{localpart}, else the own-token L2 probe
//      (GET /api/v1/status + /api/v1/teams). Because that probe does not
//      prove the Human's level, a supplied admin pair is verified FIRST
//      (adminUsername/adminPassword → Console /session/login): valid →
//      synthetic L1, invalid → 401. Without an admin pair a probe-accepted
//      account stays L2, a probe-rejected one is admitted only by the same
//      verification. A legacy L1 session rides the
//      server-side SA credential because the old Controller rejects L1
//      Matrix tokens on the data plane; the verified Console session is
//      bound server-side for the gateway tab.
// The Console track's misconfiguration (503) is surfaced only when the
// Matrix track also fails.
// External Console-only deployments retain their existing login path:
// Console only, no Matrix token/URL to the client.

import { NextRequest, NextResponse } from 'next/server';
import {
  callHigressConsole,
  collectSetCookieHeader,
  forwardCookies,
  getHigressConsoleURL,
  HigressConsoleConfigurationError,
} from '../../higress/proxy-helper';
import { getAuthToken, getControllerUrl } from '../../agentteams/proxy-helper';
import { createSession, sessionCookieHeader } from '@/lib/dashboard-session';
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

interface HumanRecord {
  name?: string;
  permissionLevel?: number;
  accessibleTeams?: string[];
  accessibleWorkers?: string[];
}

function controllerProbeTargets(request: NextRequest): string[] {
  const out: string[] = [];
  const add = (url: string | undefined) => {
    const value = url?.trim();
    if (value && !out.includes(value)) out.push(value);
  };
  add(getControllerUrl(request));
  for (const candidate of orderedCandidates('controller')) add(candidate);
  return out;
}


type MeResult =
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
async function fetchCurrentHuman(request: NextRequest, token: string): Promise<MeResult> {
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
function isUsableHuman(human: HumanRecord): boolean {
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
async function fetchHumanViaSa(request: NextRequest, localpart: string): Promise<HumanRecord | null> {
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

type LegacyOwnTokenProbe =
  | { kind: 'l2'; teams: string[] }
  | { kind: 'rejected' } // the Controller answered: this token is not L2
  | { kind: 'unavailable' }; // every candidate was unreachable

/**
 * Legacy L2 probe (pre-#214, plugin model): the old Controller's Matrix auth
 * accepts only permissionLevel=2 tokens, so a 200 on GET /api/v1/status with
 * the user's own token proves team-user identity WITHOUT reading the Human
 * CR. GET /api/v1/teams is server-side filtered to the caller's own scope.
 */
async function probeLegacyOwnToken(request: NextRequest, token: string): Promise<LegacyOwnTokenProbe> {
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
    try {
      const teamsRes = await fetch(`${base}/api/v1/teams`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      if (teamsRes.ok) {
        const data = (await teamsRes.json()) as { teams?: { name?: string }[] };
        teams = (data.teams ?? []).map((t) => t.name ?? '').filter(Boolean);
      }
    } catch { /* the scope list is optional — keep an empty scope */ }
    return { kind: 'l2', teams };
  }
  return { kind: 'unavailable' };
}

/**
 * Attempt Matrix login with the given credentials.
 * Returns the Matrix login result or null if it fails.
 */
async function tryMatrixLogin(username: string, password: string): Promise<Record<string, unknown> | null> {
  const homeserver = resolveMatrixHomeserver();
  try {
    validateHomeserverUrl(homeserver, { allowPrivateNetwork: true });
  } catch {
    return null; // Invalid homeserver URL, skip
  }

  try {
    const res = await fetch(`${homeserver}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...backendAuthHeader('matrix', homeserver) },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return {
      accessToken: data.access_token,
      userId: data.user_id,
      deviceId: data.device_id,
      homeserver,
    };
  } catch {
    return null; // Matrix unreachable or login failed, skip silently
  }
}

export async function POST(request: NextRequest) {
  const isExternal = process.env.AGENTTEAMS_HIGRESS_ADAPTER_MODE === 'external';

  try {
    const body = await request.json();
    const { username, password } = body;

    // Optional administrator verification for L1 Matrix logins on the old
    // Controller (the Console admin account/password is a different account
    // from the Human CR). Ignored by the Console track, the token-only track
    // and by L2/L3 Human identities.
    const adminUsername = typeof body.adminUsername === 'string' ? body.adminUsername.trim() : '';
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';

    const controllerToken = typeof body.controllerToken === 'string' ? body.controllerToken.trim() : '';
    if (!username && !password && controllerToken && !isExternal) {
      return await attemptControllerTokenLogin(request, controllerToken);
    }
    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Username and password are required' }, { status: 400 });
    }

    if (isExternal) {
      const result = await attemptConsoleLogin(request, username, password, { allowMatrix: false });
      return result.kind === 'failed'
        ? NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 })
        : result.response;
    }
    // Embedded/default: dual track — the Console admin account first (its
    // failure must never block a Matrix account), then the Matrix Human
    // track with the pre-1.4 Controller fallback.
    const consoleResult = await attemptConsoleLogin(request, username, password, { allowMatrix: true });
    if (consoleResult.kind === 'session') return consoleResult.response;
    const matrixResult = await attemptMatrixLogin(request, username, password, {
      username: adminUsername,
      password: adminPassword,
    });
    if (matrixResult.ok) return matrixResult;
    // A Console deployment misconfiguration (503) is surfaced only when the
    // Matrix track fails too — a working Matrix login is a login, and the
    // misconfigured message is about the admin account, not this user.
    if (consoleResult.kind === 'misconfigured') return consoleResult.response;
    return matrixResult;
  } catch (err: unknown) {
    // SEC-09: the raw error can carry internal details (session secret
    // config, upstream fetch failures). Log it server-side, return a
    // generic message — fail-closed semantics (502) are preserved.
    console.error('[auth/login] internal error:', err);
    return NextResponse.json(
      { success: false, error: 'Login failed due to an internal server error' },
      { status: 502 },
    );
  }
}

type ConsoleAttempt =
  | { kind: 'session'; response: NextResponse }
  | { kind: 'misconfigured'; response: NextResponse }
  | { kind: 'failed' };

/**
 * Console track: admin login → level-3 session with the SA credential.
 * Forwards the Console session cookie so the gateway tab keeps working.
 */
async function attemptConsoleLogin(
  request: NextRequest,
  username: string,
  password: string,
  opts: { allowMatrix: boolean },
): Promise<ConsoleAttempt> {
  let consoleUrl: string;
  try {
    consoleUrl = getHigressConsoleURL();
  } catch (err) {
    if (err instanceof HigressConsoleConfigurationError) {
      // Deployment misconfiguration (host not on the allowlist / bad URL
      // shape): the Console admin account can NEVER log in on this
      // deployment. Failing through to the Matrix track here produced a
      // misleading "无法确认该账号的权限级别" (a Matrix/permission error)
      // for what is actually a deployment configuration gap — maintainer
      // report, 9/19. Fail fast with an actionable message instead; the
      // Matrix track is still reachable for matrix accounts on the NEXT
      // attempt only if the operator fixes the config (or logs in with a
      // Matrix-native account where the Console track is irrelevant).
      console.error(`Console deployment misconfiguration: ${err.message}`);
      return {
        kind: 'misconfigured',
        response: NextResponse.json(
          {
            success: false,
            error:
              `Higress Console 部署配置错误（管理员账号暂时无法登录，这不是账号或密码问题）：${err.message}。` +
              `请将环境变量 AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS 设为包含该 Console 主机名（逗号分隔），` +
              `或通过受保护的「后端配置」页面保存 Console 地址后重建 Dashboard 容器。`,
          },
          { status: 503 }
        ),
      };
    }
    // Non-configuration runtime failure: keep the original fall-through so
    // one track's runtime hiccup never blocks the whole login endpoint.
    console.error(
      `Console track unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { kind: 'failed' };
  }

  // NOTE: the upstream auto-initializer (/system/init, "first login auto-
  // registers a Console admin") was intentionally REMOVED. It is a privilege
  // escalation path in a multi-user deployment: a fresh Console would be
  // initialized with whoever logs in first — and in the dual-track flow a
  // failed L2 (Matrix) attempt with mistyped credentials would create a
  // Console admin that the L1 track then accepts as the L1 human. The Console
  // admin account must be provisioned out-of-band (installer / first-time
  // setup only).
  let consoleRes: Response;
  try {
    // No consoleUrl option: callHigressConsole resolves the same shared URL
    // (getHigressConsoleURL). `consoleUrl` above stays for log messages only.
    const result = await callHigressConsole('/session/login', {
      method: 'POST',
      body: { username, password },
    });
    consoleRes = result.response;
  } catch (err) {
    // F1g: surface the failure in docker logs. A silently-failing Console
    // track sends admin-password users down the Matrix track into the
    // confusing "paste a Controller token" error with no trace of WHY the
    // password path died (install-verify 9/9: only the token worked).
    console.error(
      `Console track fetch failed (${consoleUrl}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { kind: 'failed' };
  }
  if (!consoleRes.ok) {
    console.error(`Console track rejected: HTTP ${consoleRes.status} for user "${username}" (${consoleUrl})`);
    return { kind: 'failed' };
  }

  // Identity = the Console username itself. The Console admin account and the
  // Human CRs are different accounts (the Console admin may have no CR):
  // no CR lookup here.
  let cookieValue: string;
  try {
    ({ cookieValue } = createSession({
      user: username,
      crLevel: 1,
      teams: [],
      credential: { kind: 'sa' },
    }));
  } catch (err) {
    return {
      kind: 'misconfigured',
      response: NextResponse.json(
        { success: false, error: `Session store unavailable: ${err instanceof Error ? err.message : 'unknown'}` },
        { status: 503 },
      ),
    };
  }

  // Chat convenience: L1's own Matrix token (client-side, chat only).
  // External mode must not return an internal homeserver URL or Matrix access
  // token to the remote client (upstream #76).
  const matrix = opts.allowMatrix ? await tryMatrixLogin(username, password) : null;

  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  // Dashboard session first, then the Higress Console cookie (gateway tab).
  // The request drives the Secure flag: an HTTP localhost login must not
  // emit a Secure cookie (it would never be sent back → data 401).
  responseHeaders.append('set-cookie', sessionCookieHeader(cookieValue, request));
  forwardCookies(consoleRes.headers, responseHeaders);

  return {
    kind: 'session',
    response: new NextResponse(
      JSON.stringify({
        success: true,
        user: { username, level: 3 },
        mode: 'higress',
        matrix,
      }),
      { status: 200, headers: responseHeaders },
    ),
  };
}

/** Human CRD permissionLevel → dashboard level (E5 inversion). */
const MATRIX_CR_LEVEL_TO_DASH_LEVEL: Record<number, 1 | 2 | 3> = { 1: 3, 2: 2, 3: 1 };

async function verifyControllerToken(request: NextRequest, token: string): Promise<boolean> {
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
 * Token-only track: the pasted Controller admin token is the credential.
 * Security note: this token is admin-grade — logging in with it grants the
 * same level-3 data-plane standing as a Console admin login, which is
 * intended for single-operator deployments. It is verified against an
 * admin-only Controller endpoint first, held server-side only
 * (credential kind 'controller-token'), and never written to the session
 * cookie, the response body, or any client-readable store.
 */
async function attemptControllerTokenLogin(
  request: NextRequest,
  controllerToken: string,
): Promise<NextResponse> {
  if (!(await verifyControllerToken(request, controllerToken))) {
    return NextResponse.json({ success: false, error: 'Controller 管理员 token 无效' }, { status: 401 });
  }

  let cookieValue: string;
  try {
    ({ cookieValue } = createSession({
      user: 'controller-admin',
      crLevel: 1,
      teams: [],
      credential: { kind: 'controller-token', token: controllerToken },
    }));
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Session store unavailable: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  responseHeaders.set('set-cookie', sessionCookieHeader(cookieValue, request));

  return new NextResponse(
    JSON.stringify({
      success: true,
      user: { username: 'controller-admin', level: 3 },
      mode: 'controller-token',
    }),
    { status: 200, headers: responseHeaders },
  );
}


/**
 * Verify the deployment admin's Console credentials (adminUsername +
 * adminPassword) against the Console session endpoint. Returns the accepted
 * response so the caller can bind the Console session server-side
 * (collectSetCookieHeader) — it is never forwarded to the browser.
 * Reuses callHigressConsole: no parallel Console client, no logging of the
 * credentials.
 */
async function verifyAdminConsoleCredentials(
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

interface AdminCredentials {
  username: string;
  password: string;
}

/**
 * Matrix track. The identity comes from the user's own Matrix token; the
 * optional admin credentials are an explicit administrator-verification
 * channel for L1 (dashboard level 3) accounts:
 * - modern Controller (/me): level 3 keeps the own-token 'matrix' credential
 *   (new auth path, #214); the verified Console session is only bound for the
 *   gateway tab.
 * - legacy Controller: level 3 rides the server-side SA credential and binds
 *   the Console session; when the SA Human lookup cannot resolve the account,
 *   a successful admin verification admits a synthetic L1 Human — including
 *   when the non-authoritative own-token L2 probe accepted the token.
 * L2/L3 Human identities resolved authoritatively (modern /me or SA Human)
 * are never elevated by the admin fields.
 */
async function attemptMatrixLogin(
  request: NextRequest,
  username: string,
  password: string,
  admin: AdminCredentials,
): Promise<NextResponse> {
  const matrix = await tryMatrixLogin(username, password);
  if (!matrix || !matrix.accessToken) {
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
  }

  const userId = typeof matrix.userId === 'string' ? matrix.userId : '';
  const localpart = userId.startsWith('@') ? userId.slice(1).split(':')[0] : username;
  const token = String(matrix.accessToken);
  const hasAdminCredentials = Boolean(admin.username && admin.password);

  // Verification is lazy and cached: only a level-3 identity (or the legacy
  // synthetic-L1 admission) consults it, and the Console is called once.
  let adminCheck: { ok: boolean; consoleCookie?: string } | undefined;
  const verifyAdmin = async (): Promise<{ ok: boolean; consoleCookie?: string }> => {
    if (!adminCheck) {
      if (!hasAdminCredentials) {
        adminCheck = { ok: false };
      } else {
        const verified = await verifyAdminConsoleCredentials(admin.username, admin.password);
        adminCheck = verified
          ? { ok: true, consoleCookie: collectSetCookieHeader(verified.response.headers) }
          : { ok: false };
      }
    }
    return adminCheck;
  };
  const adminVerificationFailed = () =>
    NextResponse.json(
      { success: false, error: '管理员账号验证失败（账号或密码不正确）' },
      { status: 401 },
    );

  let me: MeResult;
  try {
    me = await fetchCurrentHuman(request, token);
  } catch (error) {
    console.error('[auth/login] identity lookup failed:', error);
    return NextResponse.json({ success: false, error: 'Controller 无法验证用户身份，请确认已升级 Controller 并配置对应 Human' }, { status: 502 });
  }

  let human: HumanRecord;
  let legacyL1 = false;
  let consoleCookie: string | undefined;
  if (me.kind === 'human') {
    // Modern Controller: own-token identity, the server SA token is never
    // involved (#214 semantics).
    human = me.human;
  } else if (me.kind === 'rejected') {
    return NextResponse.json({ success: false, error: 'Invalid Human identity' }, { status: 401 });
  } else {
    // Legacy path: this Controller predates /api/v1/me (404/405).
    const saHuman = await fetchHumanViaSa(request, localpart);
    if (saHuman && isUsableHuman(saHuman)) {
      human = saHuman;
      legacyL1 = saHuman.permissionLevel === 1;
    } else {
      const probe = await probeLegacyOwnToken(request, token);
      if (probe.kind === 'l2') {
        // The own-token probe is NOT authoritative about the Human's level:
        // the old Controller accepts these tokens on the data plane, so an
        // L1 account passes it too and would be misread as a team L2 user.
        // An explicitly supplied admin pair is therefore verified here, and
        // a valid pair admits the account as a synthetic L1 instead. A real
        // L2 Human never reaches this branch (the SA lookup resolves it
        // above), and an invalid pair fails closed.
        if (hasAdminCredentials) {
          const verified = await verifyAdmin();
          if (!verified.ok) return adminVerificationFailed();
          consoleCookie = verified.consoleCookie;
          human = { name: localpart, permissionLevel: 1, accessibleTeams: [] };
          legacyL1 = true;
        } else {
          human = { name: localpart, permissionLevel: 2, accessibleTeams: probe.teams };
        }
      } else if (probe.kind === 'unavailable') {
        return NextResponse.json(
          { success: false, error: 'Controller 不可达，无法验证用户身份：请检查 Controller 地址配置，或升级 Controller 后重试' },
          { status: 502 },
        );
      } else if (hasAdminCredentials) {
        // Explicit administrator verification: the old Controller cannot
        // resolve this Matrix account (no SA credential or no Human CR) but a
        // verified deployment admin vouches for it → synthetic L1 Human.
        const verified = await verifyAdmin();
        if (!verified.ok) return adminVerificationFailed();
        consoleCookie = verified.consoleCookie;
        human = { name: localpart, permissionLevel: 1, accessibleTeams: [] };
        legacyL1 = true;
      } else {
        return NextResponse.json(
          {
            success: false,
            error:
              '旧版 Controller 无法验证该 Matrix 账号的权限：请在「L1 账号管理员验证」中填写管理员账号与密码，' +
              '或改用 Controller 管理员 token 登录，或升级 Controller 后重试',
          },
          { status: 401 },
        );
      }
    }
  }

  const crLevel = human.permissionLevel;
  const dashLevel = crLevel === undefined ? undefined : MATRIX_CR_LEVEL_TO_DASH_LEVEL[crLevel];
  if (!human.name || (crLevel !== 1 && crLevel !== 2 && crLevel !== 3) || !dashLevel) {
    return NextResponse.json({ success: false, error: 'Invalid Human identity' }, { status: 401 });
  }
  // Level 3 (full admin): admin credentials, when supplied, must verify —
  // an invalid pair fails closed instead of silently granting admin access.
  // L2/L3 Human identities ignore the fields entirely.
  if (dashLevel === 3 && hasAdminCredentials) {
    const verified = await verifyAdmin();
    if (!verified.ok) return adminVerificationFailed();
    consoleCookie = verified.consoleCookie ?? consoleCookie;
  }
  // Legacy L1: the old Controller's Matrix auth rejects admin-level tokens
  // on the data plane, so the session rides the server-side SA credential
  // (the SA lookup that produced the record proves the token is configured,
  // or a verified deployment admin vouched for this account). The Matrix
  // token is still returned to the client for chat only. L2/L3 (modern or
  // legacy) keep their own token — the A2 chain.
  const credential: { kind: 'sa' } | { kind: 'matrix'; token: string } =
    legacyL1 ? { kind: 'sa' } : { kind: 'matrix', token };

  let cookieValue: string;
  try {
    ({ cookieValue } = createSession({
      user: human.name || localpart,
      crLevel,
      // Level 3 (full admin) is not team-restricted; L2/L3 users are scoped.
      teams: dashLevel === 3 ? [] : (human.accessibleTeams ?? []),
      credential,
      // Server-bound Console session (administrator verification) — lets the
      // gateway tab work without sending the Console cookie to the browser.
      ...(consoleCookie ? { consoleCookie } : {}),
    }));
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Session store unavailable: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  responseHeaders.set('set-cookie', sessionCookieHeader(cookieValue, request));

  return new NextResponse(
    JSON.stringify({
      success: true,
      user: { username: human.name || localpart, level: dashLevel },
      mode: 'matrix',
      matrix,
    }),
    { status: 200, headers: responseHeaders },
  );
}

