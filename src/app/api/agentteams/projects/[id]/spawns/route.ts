import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/spawns
//
// Proxies the controller's spawn aggregation
// (`GET /api/v1/projects/{id}/spawns`, project_handler.go): the TeamHarness
// meta only tracks task state, so the controller aggregates spawn subagent
// sessions from every team worker's chats.json.
//
// Query parameters are forwarded verbatim (`team` disambiguates cross-team
// duplicate project ids), except the internal `controllerUrl` override.
//
// Statuses pass through unchanged so the panel can tell an absent endpoint
// (404/405 on Controllers without the spawn routes — hide the block) from a
// real failure (retry).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/spawns${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
  });
}
