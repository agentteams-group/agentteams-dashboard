import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/attention
//
// Proxies the controller's read-only attention aggregate
// (`GET /api/v1/projects/{id}/attention`, upstream #1434 — the workbench
// decision-modal read surface for the per-task `attention` list).
//
// The endpoint is read-only on purpose: the human answer still goes to the
// task's Matrix room, never through the controller. This proxy therefore
// only forwards GET.
//
// Query parameters are forwarded verbatim:
//   - `include_resolved` `1` = also return resolved records
//   - `limit`            page size 1..500 (controller default 200)
//   - `team`             (team, project_id) disambiguation
// except the internal `controllerUrl` override consumed by getControllerUrl.
//
// Non-OK statuses pass through (404 project missing / endpoint not deployed
// yet — Controllers before #1434, 409 ambiguous project id) so the frontend
// can render the upgrade placeholder vs a real error.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/attention${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
  });
}
