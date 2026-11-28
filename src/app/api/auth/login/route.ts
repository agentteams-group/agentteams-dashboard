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
  collectSetCookieHeader,
  forwardCookies,
  getHigressConsoleURL,
  HigressConsoleConfigurationError,
} from '../../higress/proxy-helper';
import { createSession, sessionCookieHeader } from '@/lib/dashboard-session';
import {
  consoleLoginAttempt,
  fetchCurrentHuman,
  fetchHumanViaSa,
  isUsableHuman,
  LOGIN_RETRY_DELAY_MS,
  probeLegacyOwnToken,
  sleep,
  tryMatrixLogin,
  upstreamHost,
  verifyAdminConsoleCredentials,
  verifyControllerToken,
  type HumanRecord,
  type MeResult,
} from './upstream-auth';

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
      if (result.kind === 'failed') {
        console.warn('[auth/login] final branch: external-invalid-credentials (401)');
        return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
      }
      console.warn(`[auth/login] final branch: external-${result.kind}`);
      return result.response;
    }
    // Embedded/default: dual track — the Console admin account first (its
    // failure must never block a Matrix account), then the Matrix Human
    // track with the pre-1.4 Controller fallback.
    const consoleResult = await attemptConsoleLogin(request, username, password, { allowMatrix: true });
    if (consoleResult.kind === 'session') {
      console.warn('[auth/login] final branch: console-session');
      return consoleResult.response;
    }
    const matrixResult = await attemptMatrixLogin(request, username, password, {
      username: adminUsername,
      password: adminPassword,
    });
    if (matrixResult.kind === 'ok') {
      console.warn('[auth/login] final branch: matrix-session');
      return matrixResult.response;
    }
    if (matrixResult.kind === 'unavailable') {
      console.warn('[auth/login] final branch: matrix-transient (503)');
      return matrixResult.response;
    }
    // A Console deployment misconfiguration (503) is surfaced only when the
    // Matrix track fails too — a working Matrix login is a login, and the
    // misconfigured message is about the admin account, not this user.
    if (consoleResult.kind === 'misconfigured') {
      console.error('[auth/login] final branch: console-misconfigured (503)');
      return consoleResult.response;
    }
    // A transient Console failure plus a Matrix credential rejection cannot
    // prove the password is wrong — the Console may simply be unavailable.
    if (consoleResult.kind === 'transient' && matrixResult.kind === 'invalid') {
      console.warn('[auth/login] final branch: console-transient (503)');
      return consoleResult.response;
    }
    console.warn(
      `[auth/login] final branch: ${matrixResult.kind === 'invalid' ? 'invalid-credentials (401)' : `matrix-${matrixResult.kind} (${matrixResult.response.status})`}`,
    );
    return matrixResult.response;
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
  | { kind: 'transient'; response: NextResponse }
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
  const consoleHost = upstreamHost(consoleUrl);
  let consoleCall = await consoleLoginAttempt(username, password, consoleHost, 1);
  if (consoleCall.kind === 'transient') {
    // One retry for a timeout/5xx/429; a 401 is never retried.
    await sleep(LOGIN_RETRY_DELAY_MS);
    consoleCall = await consoleLoginAttempt(username, password, consoleHost, 2);
  }
  if (consoleCall.kind === 'transient') {
    console.warn(`[auth/login] console track unavailable after retry (${consoleHost}): ${consoleCall.detail}`);
    return {
      kind: 'transient',
      response: NextResponse.json(
        {
          success: false,
          error: '认证服务暂时不可用（Console 登录超时/不可达），请稍后重试',
          retryable: true,
        },
        { status: 503 },
      ),
    };
  }
  if (consoleCall.kind === 'rejected') {
    console.error(`[auth/login] console track rejected: HTTP ${consoleCall.status} (${consoleHost})`);
    return { kind: 'failed' };
  }
  const consoleRes = consoleCall.response;

  // Identity = the Console username itself. The Console admin account and the
  // Human CRs are different accounts (the Console admin may have no CR):
  // no CR lookup here.
  let cookieValue: string;
  try {
    ({ cookieValue } = createSession({
      user: username,
      crLevel: 1,
      teams: [],
      workers: [],
      credential: { kind: 'sa' },
      identitySource: 'console',
      consoleCookie: collectSetCookieHeader(consoleRes.headers),
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
  // token to the remote client (upstream #76). A transient Matrix failure here
  // is not fatal — the Console session is already established.
  const matrixAttempt = opts.allowMatrix ? await tryMatrixLogin(username, password) : null;
  const matrix = matrixAttempt?.kind === 'ok' ? matrixAttempt.data : null;

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
      workers: [],
      credential: { kind: 'controller-token', token: controllerToken },
      identitySource: 'controller-token',
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


interface AdminCredentials {
  username: string;
  password: string;
}

type MatrixAttempt =
  | { kind: 'ok'; response: NextResponse }
  | { kind: 'invalid'; response: NextResponse } // credentials rejected → 401
  | { kind: 'unavailable'; response: NextResponse } // transient upstream → 503
  | { kind: 'failed'; response: NextResponse }; // definitive non-credential failure

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
): Promise<MatrixAttempt> {
  const matrix = await tryMatrixLogin(username, password);
  if (matrix.kind === 'invalid') {
    return {
      kind: 'invalid',
      response: NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 }),
    };
  }
  if (matrix.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      response: NextResponse.json(
        {
          success: false,
          error: '认证服务暂时不可用（Matrix 登录超时/不可达），请稍后重试',
          retryable: true,
        },
        { status: 503 },
      ),
    };
  }
  const matrixData = matrix.data;
  if (!matrixData.accessToken) {
    return {
      kind: 'invalid',
      response: NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 }),
    };
  }

  const userId = typeof matrixData.userId === 'string' ? matrixData.userId : '';
  const localpart = userId.startsWith('@') ? userId.slice(1).split(':')[0] : username;
  const token = String(matrixData.accessToken);
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
  const adminVerificationFailed = (): MatrixAttempt => ({
    kind: 'invalid',
    response: NextResponse.json(
      { success: false, error: '管理员账号验证失败（账号或密码不正确）' },
      { status: 401 },
    ),
  });

  let me: MeResult;
  try {
    me = await fetchCurrentHuman(request, token);
  } catch (error) {
    console.error('[auth/login] identity lookup failed:', error);
    return {
      kind: 'failed',
      response: NextResponse.json({ success: false, error: 'Controller 无法验证用户身份，请确认已升级 Controller 并配置对应 Human' }, { status: 502 }),
    };
  }

  let human: HumanRecord;
  let legacyL1 = false;
  let consoleCookie: string | undefined;
  if (me.kind === 'human') {
    // Modern Controller: own-token identity, the server SA token is never
    // involved (#214 semantics).
    human = me.human;
  } else if (me.kind === 'rejected') {
    return {
      kind: 'invalid',
      response: NextResponse.json({ success: false, error: 'Invalid Human identity' }, { status: 401 }),
    };
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
          human = {
            name: localpart,
            permissionLevel: 2,
            accessibleTeams: probe.teams,
            accessibleWorkers: probe.workers,
          };
        }
      } else if (probe.kind === 'unavailable') {
        return {
          kind: 'failed',
          response: NextResponse.json(
            { success: false, error: 'Controller 不可达，无法验证用户身份：请检查 Controller 地址配置，或升级 Controller 后重试' },
            { status: 502 },
          ),
        };
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
        return {
          kind: 'invalid',
          response: NextResponse.json(
            {
              success: false,
              error:
                '旧版 Controller 无法验证该 Matrix 账号的权限：请在「L1 账号管理员验证」中填写管理员账号与密码，' +
                '或改用 Controller 管理员 token 登录，或升级 Controller 后重试',
            },
            { status: 401 },
          ),
        };
      }
    }
  }

  const crLevel = human.permissionLevel;
  const dashLevel = crLevel === undefined ? undefined : MATRIX_CR_LEVEL_TO_DASH_LEVEL[crLevel];
  if (!human.name || (crLevel !== 1 && crLevel !== 2 && crLevel !== 3) || !dashLevel) {
    return {
      kind: 'invalid',
      response: NextResponse.json({ success: false, error: 'Invalid Human identity' }, { status: 401 }),
    };
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
      // Level 3 (full admin) is globally scoped by role; L2/L3 users require
      // explicit Controller-provided teams AND workers (empty means no access).
      teams: dashLevel === 3 ? [] : (human.accessibleTeams ?? []),
      workers: dashLevel === 3 ? [] : (human.accessibleWorkers ?? []),
      credential,
      identitySource: legacyL1
        ? (consoleCookie ? 'console' : 'legacy-sa')
        : 'matrix',
      // Server-bound Console session (administrator verification) — lets the
      // gateway tab work without sending the Console cookie to the browser.
      ...(consoleCookie ? { consoleCookie } : {}),
    }));
  } catch (err) {
    return {
      kind: 'failed',
      response: NextResponse.json(
        { success: false, error: `Session store unavailable: ${err instanceof Error ? err.message : 'unknown'}` },
        { status: 503 },
      ),
    };
  }

  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  responseHeaders.set('set-cookie', sessionCookieHeader(cookieValue, request));

  return {
    kind: 'ok',
    response: new NextResponse(
      JSON.stringify({
        success: true,
        user: { username: human.name || localpart, level: dashLevel },
        mode: 'matrix',
        matrix: matrixData,
      }),
      { status: 200, headers: responseHeaders },
    ),
  };
}

