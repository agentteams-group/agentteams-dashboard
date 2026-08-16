import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/history
//
// Proxies the controller's intervention-history list endpoint
// (`GET /api/v1/projects/{id}/history`, see
// docs/zh-cn/usage/project-workflow-api.md).
//
// Query parameters are forwarded to the controller (notably `?team=`,
// the (team, project_id) disambiguation), except the internal
// `controllerUrl` override consumed by getControllerUrl.
//
// Non-OK statuses pass through (404 project missing / endpoint not
// deployed yet, 403 cross-team) so the frontend can render the
// "active after Controller upgrade" placeholder vs a real error.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/history${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    { forwardBody: false },
  );
}
