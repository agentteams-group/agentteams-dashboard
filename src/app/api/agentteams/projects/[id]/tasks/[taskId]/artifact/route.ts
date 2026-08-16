import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/projects/{id}/tasks/{taskId}/artifact
//
// Proxies the AgentTeams controller artifact endpoint
// (`GET /api/v1/projects/{id}/tasks/{taskId}/artifact`, agentteams/AgentTeams#1169
// O19). Query params are forwarded (notably `?path=` to pick a specific
// deliverable). The controller performs the path whitelist + existence
// checks; the proxy just streams the binary response through.
//
// Content-Disposition is passed through so RFC 5987-encoded filenames
// (Chinese names) survive the proxy and the browser names the download
// correctly. Non-2xx statuses (400 invalid path, 404 artifact missing,
// 403 cross-team) are passed through for the frontend to distinguish.
export async function GET(
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
  const path = `/api/v1/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/artifact${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    path,
    {
      forwardBody: false,
      stream: true,
      passthroughHeaders: ['content-disposition'],
    },
  );
}
