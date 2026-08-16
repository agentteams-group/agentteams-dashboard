import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/history/{ts}
//
// Proxies one pre-intervention snapshot's raw meta JSON
// (`GET /api/v1/projects/{id}/history/{ts}` — 19-digit unix nanosecond
// timestamp, see docs/zh-cn/usage/project-workflow-api.md).
//
// Query parameters are forwarded (notably `?team=`), except the internal
// `controllerUrl` override. Non-OK statuses pass through (404 snapshot
// missing / endpoint not deployed yet, 403 cross-team).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ts: string }> },
) {
  const { id, ts } = await params;

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/projects/${encodeURIComponent(id)}/history/${encodeURIComponent(ts)}${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    { forwardBody: false },
  );
}
