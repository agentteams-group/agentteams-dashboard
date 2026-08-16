import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/workflow
//
// Proxies the AgentTeams controller workflow endpoint
// (`GET /api/v1/projects/{id}/workflow`, agentteams/AgentTeams#1169).
//
// Query parameters are forwarded to the controller (notably
// `?includeTasks=true`, which attaches per-task TaskMeta as tasks_detail),
// except the internal `controllerUrl` override consumed by getControllerUrl.
//
// Unlike the list route we pass through non-OK statuses (404 project
// missing, 403 cross-team) so the frontend can distinguish "project not
// found" from "endpoint unavailable".
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/workflow${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    { forwardBody: false },
  );
}
