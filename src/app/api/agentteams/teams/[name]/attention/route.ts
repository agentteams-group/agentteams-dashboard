import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/teams/{name}/attention
//
// Proxies the controller's team-scoped attention inbox
// (`GET /api/v1/teams/{name}/attention`, upstream #1503 — the data source of
// the team inbox). It reads the same per-task `attention` records as the
// project-scoped endpoint, one level up: every project of the team, then
// every graph task of every project.
//
// Query parameters are forwarded verbatim:
//   - `status` `open` (default) | `overdue` | `resolved` | `all`; anything
//              else is a controller 400
//   - `limit`  1..1000 (controller default 200); above/below is a 400, never
//              a clamp
// except the internal `controllerUrl` override consumed by getControllerUrl.
//
// Read-only: the human answer still goes to the task's Matrix room, so this
// route only forwards GET. Non-OK statuses pass through (404 team missing or
// endpoint not deployed yet — Controllers before #1503, 400 invalid
// status/limit) so the frontend can render the upgrade placeholder instead of
// an error.
//
// The two response headers the controller sets on degradation/truncation
// (`X-Attention-Skipped`, `X-Attention-Truncated`) tell a limited result apart
// from a genuinely empty inbox, so they are forwarded too.
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  // The controller applies its own team-scoped auth (a caller who cannot read
  // the team gets a 404). The dashboard gate mirrors every other team read so
  // a scoped session cannot even reach the controller path.
  const denied = await enforceServerSideRbac(request, 'view', 'team', name);
  if (denied) return denied;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/teams/${encodeURIComponent(name)}/attention${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
    passthroughHeaders: ['x-attention-skipped', 'x-attention-truncated'],
  });
}
