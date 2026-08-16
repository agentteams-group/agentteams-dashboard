import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// POST /api/agentteams/projects/{id}/tasks/{taskId}/cancel
//
// Proxies the AgentTeams controller task-cancellation endpoint
// (`POST /api/v1/projects/{id}/tasks/{taskId}/cancel`,
// agentteams/AgentTeams#1172). The JSON body ({ reason, replacementTaskId? })
// is forwarded as-is; `team` is forwarded as a query param for (team,
// project_id) identity scoping (#1169).
//
// Non-2xx statuses are passed through (400 missing reason, 404 task not in
// project, 409 terminal task, 403 cross-team) so the frontend can surface
// the controller's exact reason. On success the controller returns 200 with
// the refreshed workflow JSON.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/cancel${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    { method: 'POST', forwardBody: true },
  );
}
