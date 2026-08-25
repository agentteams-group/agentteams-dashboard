import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

// POST /api/agentteams/projects/{id}/resume
//
// Proxies the AgentTeams controller intervention endpoint
// (`POST /api/v1/projects/{id}/resume`, agentteams/AgentTeams#1172).
// No request body is required; the controller sets the project back to
// active and notifies the team. `team` is forwarded as a query param for
// (team, project_id) identity scoping (#1169).
//
// Non-2xx statuses are passed through (409 "project is not paused", 403
// cross-team). On success the controller returns 200 with the refreshed
// workflow JSON.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const denied = await enforceLevelOnlyRbac(request, 'update', 'project', id);
  if (denied) return denied;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/resume${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    { method: 'POST', forwardBody: true },
  );
}
