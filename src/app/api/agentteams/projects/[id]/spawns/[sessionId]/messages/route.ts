import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/spawns/{sessionId}/messages
//
// Proxies one spawn session's conversation stream
// (`GET /api/v1/projects/{id}/spawns/{sessionId}/messages`, project_handler.go).
// The controller reads the worker's history.db mirror read-only and reports
// `has_more` when older rows were truncated by `limit` (1..50, default 20).
//
// Statuses pass through unchanged: 404 = session unknown to this project or no
// readable history mirror (empty state), 403 = cross-team access (no
// permission), the rest retryable.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path =
    `/api/v1/projects/${encodeURIComponent(id)}/spawns/` +
    `${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
  });
}
