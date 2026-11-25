import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/signal-events
//
// Proxies the controller's read-only signal-event feed
// (`GET /api/v1/projects/{id}/signal-events`, upstream #1433 — the browse
// read surface for SIG-* events written since #1405).
//
// Query parameters are forwarded verbatim:
//   - `type`   repeatable and/or comma-separated event-type filter
//   - `task`   task-scoped filter (controller also accepts `taskId`)
//   - `since`  RFC3339 lower bound (inclusive)
//   - `limit`  page size 1..200 (controller default 50)
//   - `cursor` opaque base64url cursor (`<occurred_at>\0<event_id>`)
//   - `team`   (team, project_id) disambiguation; without it a bare id that
//              exists in two teams returns 409
// except the internal `controllerUrl` override consumed by getControllerUrl.
//
// Non-OK statuses pass through (404 project missing / endpoint not deployed
// yet — Controllers before #1433, 400 invalid cursor/since/limit, 409
// ambiguous project id) so the frontend can distinguish the upgrade
// placeholder from a real error.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/signal-events${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
  });
}
