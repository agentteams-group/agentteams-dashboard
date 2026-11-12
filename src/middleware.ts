import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from './lib/dashboard-session';
import { isStatelessAuthMode, statelessDegradedResponse } from './lib/static-mode';
import { resolveStaticIdentity } from './lib/static-identity';

// Force Node.js runtime because api-auth.ts imports higress/proxy-helper which
// uses AbortController/timeout patterns that are safer under Node runtime.
export const runtime = 'nodejs';

// Public endpoints that do NOT require a Higress browser session.
// Only genuinely public endpoints (health checks, setup bootstrap) belong here.
// setup/status used to be listed here, but it proxies the controller's setup
// state with the server-side SA token attached — an unauthenticated caller
// could abuse ?controllerUrl= to make the dashboard relay that credential to
// an arbitrary internal host:port (SEC-06). The page only calls it from the
// authenticated branch (page.tsx), so it now sits behind the normal gate.
const PUBLIC_PATHS = [
  '/api/agentteams/setup/ensure-ai',
  // F1 backend setup: the pre-login first-launch flow must be reachable
  // before any session exists. Writes are token-gated (pre-login one-shot)
  // or level-3 session-gated (post-login) inside the route itself.
  '/api/agentteams/setup/backends',
  // F7: the mode probe must be reachable pre-login so the client can pick
  // the right login flow (discloses no secrets — only the deployment shape).
  '/api/agentteams/mode',
  // Pre-login connectivity probe: client-auth-fetch polls this to check the
  // data plane is up. It discloses nothing beyond reachability, and a 401
  // here is indistinguishable to the client from a real auth failure, so
  // it stays public (matches both /healthz and /healthz/ via startsWith).
  '/api/agentteams/healthz',
];

const USER_NAME_HEADER = 'x-agentteams-user';
const USER_LEVEL_HEADER = 'x-agentteams-user-level';

function withUserHeaders(request: NextRequest, user: { name: string; level: number } | null): Headers {
  const headers = new Headers(request.headers);
  if (user) {
    headers.set(USER_NAME_HEADER, user.name);
    headers.set(USER_LEVEL_HEADER, String(user.level));
  } else {
    headers.delete(USER_NAME_HEADER);
    headers.delete(USER_LEVEL_HEADER);
  }
  return headers;
}

// Backward compatibility for embedded mode: old /dashboard/ URLs redirect to root
// because the dashboard is now served at "/" when NEXT_PUBLIC_BASE_PATH is empty.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy redirect
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    const target = pathname.replace(/^\/dashboard/, '') || '/';
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url);
  }

  // CORS preflight requests never carry credentials — let them through so
  // browsers can complete the OPTIONS handshake.
  if (request.method === 'OPTIONS') {
    return NextResponse.next();
  }

  // API auth gate: protect ALL /api/agentteams/* routes.
  // Identity = the dashboard session cookie (at_dash_sess), created by the
  // dual-track login (M19): L1 = Higress Console admin (SA credential,
  // dashboard level 3) or L2 = Matrix login (own Matrix token, level 2).
  // The Controller credential (SA or Matrix token) never leaves the server —
  // see proxy-helper: "NEVER trust browser-supplied Authorization header".
  if (pathname.startsWith('/api/agentteams/')) {
    const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (isPublicPath) {
      return NextResponse.next();
    }

    // Escape hatch for environments without a Higress Console in front of
    // the dashboard (local dev, hosted previews): there is no browser
    // session to validate, so the gate would 401 every request including
    // data reads. Production deployments leave this unset to keep the gate.
    // Read per-request (not module-level) so env changes apply on reload.
    // A synthetic identity is injected so server-side RBAC evaluation and
    // audit read/write attribution keep working (the audit routes reject
    // identity-less requests, which would permanently break the audit
    // viewer in local mode). Defaults to platform-admin level 3 — local
    // mode is a single-user trusted environment — and can be overridden.
    if (process.env.AGENTTEAMS_AUTH_DISABLED === 'true') {
      const localUser = {
        name: process.env.AGENTTEAMS_LOCAL_USER ?? 'local-admin',
        level: Number(process.env.AGENTTEAMS_LOCAL_USER_LEVEL ?? 3),
      };
      const headers = withUserHeaders(request, {
        name: localUser.name,
        level: Number.isFinite(localUser.level) ? localUser.level : 3,
      });
      const res = NextResponse.next({ request: { headers } });
      res.headers.set('x-agentteams-auth-mode', 'disabled');
      return res;
    }

    // ── F7 stateless mode: the browser bearer token IS the credential ──
    // No server session. Identity is derived per token (cached) from the
    // controller + homeserver; any client-claimed identity headers are
    // overwritten by withUserHeaders (anti-forgery — the token, not the
    // header, is the credential, and the Controller re-authenticates every
    // data call natively).
    if (isStatelessAuthMode()) {
      // Route families that need server-side credentials degrade with an
      // actionable 501 instead of an opaque upstream failure.
      const degraded = statelessDegradedResponse(pathname);
      if (degraded) return degraded;

      const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim();
      if (!bearer) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const result = await resolveStaticIdentity(request);
      if (result === null) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (result.ok === 'unreachable') {
        return NextResponse.json(
          { error: '无法解析身份（后端不可达）', detail: result.detail },
          { status: 503 },
        );
      }
      if (result.ok === 'invalid') {
        return NextResponse.json(
          { error: '凭据无效或已失效，请重新登录', detail: result.detail },
          { status: 401 },
        );
      }
      const headers = withUserHeaders(request, { name: result.identity.name, level: result.identity.level });
      const res = NextResponse.next({ request: { headers } });
      res.headers.set('x-agentteams-auth-mode', 'stateless');
      return res;
    }

    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Forward the resolved identity downstream so route handlers (and the
    // Controller proxy) can apply server-side RBAC + audit attribution.
    // `level` is already the dashboard rbac-engine level (E5 mapping applied
    // at session creation: CRD 1→3, 2→2, 3→1).
    return NextResponse.next({
      request: { headers: withUserHeaders(request, { name: session.user, level: session.level }) },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*', '/api/agentteams/:path*'],
};
