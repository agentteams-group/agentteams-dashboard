// GET /api/auth/session - Resolve the browser's dashboard session (M19).
//
// The dashboard session cookie (at_dash_sess) is created by the dual-track
// login. `username` is the Human CR name (never a Higress consumer name —
// the old /v1/consumers probe reported the first consumer, which is why the
// UI used to show "manager" for everyone). `level` is the dashboard
// rbac-engine level (3 Admin / 2 Operator / 1 Observer) used by the UI
// level gate; the security boundary remains server-side (middleware +
// Controller A2).
import { NextRequest, NextResponse } from 'next/server';
import { validateHigressCookieString, validateHigressSession } from '@/lib/api-auth';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { isStatelessAuthMode } from '@/lib/static-mode';
import { resolveStaticIdentity } from '@/lib/static-identity';
import { reverifyDashboardSession } from '@/lib/identity-revalidation';

export async function GET(request: NextRequest) {
  // F7 stateless mode: no server session — resolve the identity from the
  // bearer token the client sent (the same resolver the middleware uses,
  // so the UI and the data plane agree). `reason` distinguishes "no
  // credential yet" (show the login page) from "backend unreachable"
  // (show a retryable error — the stored token may still be valid).
  if (isStatelessAuthMode()) {
    const result = await resolveStaticIdentity(request);
    if (result === null) {
      return NextResponse.json({ authenticated: false, reason: 'no-credential' }, { status: 200 });
    }
    if (result.ok === 'unreachable') {
      return NextResponse.json(
        { authenticated: false, reason: 'unreachable', detail: result.detail },
        { status: 200 },
      );
    }
    if (result.ok === 'invalid') {
      return NextResponse.json(
        { authenticated: false, reason: 'invalid', detail: result.detail },
        { status: 200 },
      );
    }
    return NextResponse.json({
      authenticated: true,
      username: result.identity.name,
      level: result.identity.level,
      teams: result.identity.teams,
      workers: result.identity.workers,
      mode: 'stateless',
    }, { status: 200 });
  }

  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  const verification = await reverifyDashboardSession(session);
  if (verification.ok !== true) {
    if (verification.ok === 'invalid') {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }
    return NextResponse.json(
      { authenticated: false, reason: 'unreachable', detail: verification.detail },
      { status: 503 },
    );
  }

  // 12.15（装验反馈：luo 登录后模型页仍打 /api/higress/* 拿 401）：
  // 浏览器是否持有有效 Higress Console 会话——网关管理面的真实门控。
  // 客户端此前误用 dashboard 会话判定 canManage（登录≠Console 会话）。
  let higressSession = false;
  try {
    higressSession = (await validateHigressSession(request)).valid;
    if (!higressSession) {
      // 12.16: server-bound Console session (L1 + admin verification).
      const bound = getSessionFromRequest(request);
      if (bound?.consoleCookie) {
        higressSession = (await validateHigressCookieString(bound.consoleCookie)).valid;
      }
    }
  } catch {
    higressSession = false;
  }

  return NextResponse.json({
    authenticated: true,
    username: session.user,
    level: session.level,
    teams: session.teams,
    workers: session.workers,
    mode: session.credential.kind === 'sa' ? 'higress' : 'matrix',
    higressSession,
  }, { status: 200 });
}
