// Human logins use Matrix identity and Controller authorization.
// External Console-only deployments retain their existing login path.

import { NextRequest, NextResponse } from 'next/server';
import {
  callHigressConsole,
  forwardCookies,
  getHigressConsoleURL,
  HigressConsoleConfigurationError,
} from '../../higress/proxy-helper';
import { getControllerUrl } from '../../agentteams/proxy-helper';
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


/** Resolve the caller using only their own token. Older Controllers fail explicitly. */
async function fetchCurrentHuman(request: NextRequest, token: string): Promise<HumanRecord | null> {
  for (const base of controllerProbeTargets(request)) {
    try {
      const res = await fetch(`${base}/api/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) return null;
      if (res.ok) return await res.json() as HumanRecord;
    } catch { /* try the next configured Controller */ }
  }
  throw new Error('Controller unavailable or missing /api/v1/me support');
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
    return await attemptMatrixLogin(request, username, password);
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
  responseHeaders.set('set-cookie', sessionCookieHeader(cookieValue));

  return new NextResponse(
    JSON.stringify({
      success: true,
      user: { username: 'controller-admin', level: 3 },
      mode: 'controller-token',
    }),
    { status: 200, headers: responseHeaders },
  );
}


async function attemptMatrixLogin(
  request: NextRequest,
  username: string,
  password: string,
): Promise<NextResponse> {
  const matrix = await tryMatrixLogin(username, password);
  if (!matrix || !matrix.accessToken) {
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
  }

  const userId = typeof matrix.userId === 'string' ? matrix.userId : '';
  const localpart = userId.startsWith('@') ? userId.slice(1).split(':')[0] : username;
  let human: HumanRecord | null;
  try {
    human = await fetchCurrentHuman(request, String(matrix.accessToken));
  } catch (error) {
    console.error('[auth/login] identity lookup failed:', error);
    return NextResponse.json({ success: false, error: 'Controller 无法验证用户身份，请确认已升级 Controller 并配置对应 Human' }, { status: 502 });
  }
  if (!human) return NextResponse.json({ success: false, error: 'Invalid Human identity' }, { status: 401 });
  const crLevel = human.permissionLevel;
  const dashLevel = crLevel === undefined ? undefined : MATRIX_CR_LEVEL_TO_DASH_LEVEL[crLevel];
  if (!human.name || (crLevel !== 1 && crLevel !== 2 && crLevel !== 3) || !dashLevel) {
    return NextResponse.json({ success: false, error: 'Invalid Human identity' }, { status: 401 });
  }
  const credential = { kind: 'matrix' as const, token: String(matrix.accessToken) };

  let cookieValue: string;
  try {
    ({ cookieValue } = createSession({
      user: human.name || localpart,
      crLevel,
      // Level 3 (full admin) is not team-restricted; L2/L3 users are scoped.
      teams: dashLevel === 3 ? [] : (human.accessibleTeams ?? []),
      credential,
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

