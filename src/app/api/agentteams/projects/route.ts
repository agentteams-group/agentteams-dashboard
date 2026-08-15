import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects
//
// Proxies the AgentTeams controller project list endpoint
// (`GET /api/v1/projects`, introduced by agentteams/AgentTeams#1169).
//
// Query parameters are forwarded to the controller (notably `?team=`, which
// the W-PR-1 list endpoint supports), except the internal `controllerUrl`
// override consumed by getControllerUrl.
//
// The controller API may not be deployed yet (W-PR-1 not merged / controller
// not upgraded). In that case the upstream returns 404 and we degrade to an
// empty list with an `error` hint so the dashboard board still renders
// (the existing team-tasks board remains the fallback data source).
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    params.append(key, value);
  }
  const qs = params.toString();
  const path = `/api/v1/projects${qs ? `?${qs}` : ''}`;

  const res = await proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
  });

  if (res.ok) {
    return res;
  }

  const status = res.status;
  let error = `HTTP ${status}`;
  try {
    const body = await res.json();
    // Controller errors use `{ message }` (httputil.ErrorResponse); accept
    // `{ error }` too for middleware-shaped bodies.
    if (body && typeof body === 'object') {
      const b = body as { error?: unknown; message?: unknown };
      if (typeof b.message === 'string' && b.message) error = b.message;
      else if (typeof b.error === 'string' && b.error) error = b.error;
    }
  } catch {
    // non-JSON error body; keep the generic message
  }

  // Distinguish "API not deployed yet" (404 — W-PR-1 not merged / controller
  // not upgraded) from "controller endpoint exists but failed" (500+ — e.g.
  // MinIO unreachable). Both degrade to an empty list so the board still
  // renders, but the frontend can show a different hint for each.
  const degradedReason: 'api-not-deployed' | 'controller-error' =
    status >= 500 ? 'controller-error' : 'api-not-deployed';

  return NextResponse.json(
    {
      projects: [],
      total: 0,
      error,
      degraded: true,
      degradedReason,
    },
    { status: 200 },
  );
}
