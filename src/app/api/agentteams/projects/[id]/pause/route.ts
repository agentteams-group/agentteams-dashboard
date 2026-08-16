import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// POST /api/agentteams/projects/{id}/pause
//
// Proxies the AgentTeams controller intervention endpoint
// (`POST /api/v1/projects/{id}/pause`, agentteams/AgentTeams#1172).
// The JSON body ({ reason?: string }) is forwarded as-is; `team` is passed
// as a query param for (team, project_id) identity scoping (#1169), while
// the internal `controllerUrl` override is dropped.
//
// Non-2xx statuses are passed through (409 "project is already paused" /
// "cannot pause a completed project", 403 cross-team) so the frontend can
// surface the controller's exact conflict reason. On success the controller
// returns 200 with the refreshed workflow JSON.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/pause${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    { method: 'POST', forwardBody: true },
  );
}
