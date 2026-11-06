// POST /api/auth/login - Dual-track multi-user authentication (M19 / batch M).
//
// Track Console (deployment admin account):
//   Console /session/login. The Console is single-operator: whoever holds the
//   admin password IS the deployment admin. Identity = the logged-in username
//   itself (NO Human CR lookup — the Console admin account is not required to
//   have a Human CR). The session carries the admin SA credential
//   (server-side only, level 3). The Higress Console session cookie is still
//   forwarded so the gateway tab (/api/higress/*) keeps working.
//
// Track Matrix (any Human account):
//   Server-side Matrix password login → own access token → localpart →
//   SA GET /humans/{localpart}; permissionLevel maps 1→3 (full),
//   2→2 (scoped to accessibleTeams), 3→1 (observer). Level 3 via this track
//   additionally requires admin verification (admin account password OR a
//   pasted Controller admin token) before the session may use admin-grade
//   data-plane credentials.
//   The session carries the user's Matrix token (server-side only) as the
//   Controller credential for level 2/3 — A2 chain scopes reads to
//   accessibleTeams. Non-Human Matrix accounts (no CR) → generic 401.
//
// Both tracks fail → 401. Session secret missing → login fails closed
// (dashboard-session throws, logged once).
//
// External mode (AGENTTEAMS_HIGRESS_ADAPTER_MODE=external) keeps the upstream
// #76 semantics: no init, Console-only, no Matrix (remote clients must not
// receive internal homeserver tokens).

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
import { pickBackendUrl } from '@/lib/backend-config';
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

/**
 * Resolve a Human CR via the admin SA token. Returns null when the controller
 * is unreachable, the token is missing, or the human does not exist.
 */
async function fetchHumanViaSa(request: NextRequest, name: string): Promise<HumanRecord | null> {
  const token = await getAuthToken();
  if (!token) return null;
  return fetchHumanWithToken(request, name, token);
}

/** Identity probe with the user's OWN Matrix token. The Controller's
 * Matrix auth only accepts permissionLevel=2 tokens, so a 200 on the
 * status endpoint proves team-user identity WITHOUT reading the Human CR
 * (the plugin's model: the user's own access token is the default
 * identity, admin tokens are an optional channel — agentteams_connector/
 * config.py `controller_token` = "Optional admin token for L1 full view"). */
async function probeMatrixToken(request: NextRequest, matrixToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${getControllerUrl(request)}/api/v1/status`, {
      headers: { Authorization: `Bearer ${matrixToken}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Teams visible to the caller's own Matrix token — the Controller
 * filters the list by accessibleTeams server-side (ListTeams), so this is
 * the user's own team scope, not an admin read. */
async function fetchTeamsWithToken(request: NextRequest, matrixToken: string): Promise<string[]> {
  try {
    const res = await fetch(`${getControllerUrl(request)}/api/v1/teams`, {
      headers: { Authorization: `Bearer ${matrixToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { teams?: { name?: string }[] };
    return (data.teams ?? []).map((t) => t.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

/** CR lookup with an explicit admin-grade token (SA env or a validated
 * Controller admin token pasted at login — one-person-per-instance
 * deployments may hold no server-side SA credential at all). */
async function fetchHumanWithToken(request: NextRequest, name: string, token: string): Promise<HumanRecord | null> {
  try {
    const res = await fetch(`${getControllerUrl(request)}/api/v1/humans/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HumanRecord;
  } catch {
    return null;
  }
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
      headers: { 'Content-Type': 'application/json' },
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
    // Optional admin verification (two alternatives) — only consumed by the
    // Matrix track for top-permission (CR level 1) accounts; see
    // attemptMatrixLogin. adminUsername+adminPassword (Console check) OR
    // controllerToken (Bearer check against the Controller).
    const adminUsername = typeof body.adminUsername === 'string' ? body.adminUsername.trim() : '';
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';
    const controllerToken = typeof body.controllerToken === 'string' ? body.controllerToken.trim() : '';

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Username and password are required' }, { status: 400 });
    }

    // Dual track: try the Console (L1) first; on failure fall through to
    // Matrix (any Human level).
    // External mode (upstream #76): no init, no Matrix token/URL to the
    // remote client.
    const l1 = await attemptConsoleLogin(request, username, password, { allowMatrix: !isExternal });
    if (l1.kind === 'session') {
      return l1.response;
    }
    if (l1.kind === 'misconfigured') {
      return l1.response;
    }

    // External mode (upstream #76): Console credential failure stops here —
    // falling through to attemptMatrixLogin would probe the internal
    // homeserver with the remote client's credentials and could return
    // Matrix-track responses (mode:'matrix' + access token), violating the
    // no-Matrix-token/URL contract declared at the top of this file.
    // Response shape mirrors attemptMatrixLogin's credential-failure 401.
    if (isExternal) {
      return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
    }
    return await attemptMatrixLogin(request, username, password, adminUsername, adminPassword, controllerToken);
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
  responseHeaders.append('set-cookie', sessionCookieHeader(cookieValue));
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

/**
 * Verify the admin account's Console credentials (deployment admin username +
 * password). Returns true only when the Console accepts them. Used to gate
 * admin-level data-plane access for top-permission accounts logging in via
 * the Matrix track — replaces pasting the raw Controller token: the token
 * never leaves the server (it is the AGENTTEAMS_AUTH_TOKEN env value).
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
    // 12.16: return the response so the caller can bind the verified Console
    // session server-side (collectSetCookieHeader) — it is still NOT
    // forwarded to the browser.
    return response.ok ? { response } : null;
  } catch {
    return null;
  }
}

/**
 * Verify a user-supplied Controller admin token by calling an ADMIN-ONLY
 * endpoint. GET /api/v1/humans (list) is denied for L2 Matrix tokens by the
 * Controller authorizer (RoleHuman has no "human" case → 403) and accepted
 * for admin/manager tokens, so passing this proves the token is admin-grade,
 * not merely authenticated. The previous check hit GET /api/v1/teams, which
 * an L2 token also returns 200 for (ListTeams filters by accessibleTeams
 * but still succeeds) — a non-admin token would pass verification and be
 * stored as the session's admin data-plane credential (kind
 * 'controller-token').
 */
async function verifyControllerToken(request: NextRequest, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${getControllerUrl(request)}/api/v1/humans`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Matrix track: password login for ANY Human account (top-permission level
 * 1 / operators level 2 / observers level 3) → session carrying server-side
 * credentials. The level is derived from the Human CR's permissionLevel —
 * never from the username string.
 *
 * Credential selection:
 * - Dashboard level 3 via Matrix (CR level 1): the Controller's Matrix auth
 *   only accepts level-2 tokens, so the user's own Matrix token would 401 on
 *   every data-plane call. Admin-level data access is gated on EITHER
 *   verifying the admin account's CONSOLE PASSWORD (adminUsername/
 *   adminPassword → session uses the server's SA token, kind 'sa', which
 *   never leaves the server) OR a pasted Controller admin TOKEN (verified
 *   against the Controller → kind 'controller-token', held server-side only;
 *   same as the workbench plugin's admin-token mode). The Matrix token is
 *   still returned for the chat tab.
 * - Dashboard level 2/3 (CR level 2/3): the user's own Matrix token; A2
 *   scopes level-2 reads to accessibleTeams. Admin verification is ignored.
 */
async function attemptMatrixLogin(
  request: NextRequest,
  username: string,
  password: string,
  adminUsername: string,
  adminPassword: string,
  controllerToken: string,
): Promise<NextResponse> {
  const matrix = await tryMatrixLogin(username, password);
  if (!matrix || !matrix.accessToken) {
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
  }

  const userId = typeof matrix.userId === 'string' ? matrix.userId : '';
  const localpart = userId.startsWith('@') ? userId.slice(1).split(':')[0] : username;
  let human = await fetchHumanViaSa(request, localpart);
  if (!human && controllerToken) {
    // One-person-per-instance deployment: the server may hold no admin
    // credential (no AGENTTEAMS_AUTH_TOKEN). The Controller admin token
    // pasted at login (existing L1 field) can perform the same level
    // lookup — validated against the Controller before use. The L2-only
    // matrix token itself is denied on human reads (controller
    // authorizeHuman has no "human" case), so without an admin-grade
    // token here the lookup is impossible; the upstream GET /api/v1/me
    // (self-scope) would close that gap for L2.
    if (await verifyControllerToken(request, controllerToken)) {
      human = await fetchHumanWithToken(request, localpart, controllerToken);
    } else {
      return NextResponse.json(
        { success: false, error: 'Controller 管理员 token 无效' },
        { status: 401 },
      );
    }
  }
  if (!human) {
    // No admin-grade credential available (SA-less one-person-per-instance):
    // identify with the user's OWN Matrix token instead of an admin read.
    // A 200 proves team-user (L2) identity — the Controller's Matrix auth
    // rejects every other level — and the teams list carries the user's
    // own accessibleTeams (server-side filtered). Plugin-aligned: own
    // token = default identity, no admin credential needed for L2.
    if (await probeMatrixToken(request, String(matrix.accessToken))) {
      human = {
        name: localpart,
        permissionLevel: 2,
        accessibleTeams: await fetchTeamsWithToken(request, String(matrix.accessToken)),
      };
    } else {
      return NextResponse.json(
        {
          success: false,
          error: '无法确认该账号的权限级别：请展开「管理员账号验证」提供 Controller 管理员 token，或联系部署管理员检查 Human CR',
        },
        { status: 401 },
      );
    }
  }
  const crLevel = human && typeof human.permissionLevel === 'number' ? human.permissionLevel : -1;
  const dashLevel = MATRIX_CR_LEVEL_TO_DASH_LEVEL[crLevel];
  if (!human || !dashLevel) {
    // No Human CR (or unknown level) for this Matrix account → generic 401.
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
  }

  // Level 3 via Matrix (CR level 1): the data plane needs admin-grade access
  // (the Controller's Matrix auth rejects level-1 tokens). Gate it on EITHER
  // the admin account's Console password OR a pasted Controller admin token.
  let credential: { kind: 'sa' } | { kind: 'matrix'; token: string } | { kind: 'controller-token'; token: string };
  // 12.16: Console session captured from the admin verification and bound to
  // the dashboard session server-side (never sent to the browser).
  let consoleCookie: string | undefined;
  if (dashLevel === 3) {
    if (adminUsername && adminPassword) {
      const adminRes = await verifyAdminConsoleCredentials(adminUsername, adminPassword);
      if (!adminRes) {
        return NextResponse.json({ success: false, error: '管理员账号验证失败（账号或密码不正确）' }, { status: 401 });
      }
      credential = { kind: 'sa' };
      consoleCookie = collectSetCookieHeader(adminRes.response.headers);
    } else if (controllerToken) {
      const tokenOk = await verifyControllerToken(request, controllerToken);
      if (!tokenOk) {
        return NextResponse.json({ success: false, error: 'Controller 管理员 token 无效' }, { status: 401 });
      }
      credential = { kind: 'controller-token', token: controllerToken };
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'L1 账号需要管理员验证：请展开「管理员账号验证」填写管理员账号与密码，或 Controller 管理员 token（二选一，由部署管理员提供）',
        },
        { status: 400 },
      );
    }
  } else {
    credential = { kind: 'matrix', token: String(matrix.accessToken) };
  }

  let cookieValue: string;
  try {
    ({ cookieValue } = createSession({
      user: human.name || localpart,
      crLevel,
      // Level 3 (full admin) is not team-restricted; L2/L3 users are scoped.
      teams: dashLevel === 3 ? [] : (human.accessibleTeams ?? []),
      credential,
      // 12.16: server-bound Console session (admin verification) — lets the
      // operator's own login manage the model gateway (see higress/access).
      consoleCookie,
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
  responseHeaders.set('set-cookie', sessionCookieHeader(cookieValue));

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

