import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// POST /api/agentteams/projects/{id}/replan
//
// Proxies the AgentTeams controller replan endpoint
// (`POST /api/v1/projects/{id}/replan`, agentteams/AgentTeams#1172).
// The JSON body ({ tasks: [...] }) is forwarded as-is; the controller
// validates the new DAG with TeamHarness semantics (duplicate task ids,
// unknown dependencies and cycles are rejected) and normalizes fields.
// `team` is forwarded as a query param for (team, project_id) identity
// scoping (#1169).
//
// Non-2xx statuses are passed through (409 plan_type/status/executing-task
// preconditions, 400 invalid body, 403 cross-team). On success the
// controller returns 200 with the refreshed workflow JSON.
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
  const path = `/api/v1/projects/${encodeURIComponent(id)}/replan${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    { method: 'POST', forwardBody: true },
  );
}
