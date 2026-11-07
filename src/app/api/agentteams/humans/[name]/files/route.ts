import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/humans/{name}/files
//
// Proxies the files-root endpoint (`GET /api/v1/humans/{name}/files`,
// human_files_handler.go listFiles). Without `?recursive=1` the controller
// lists the first level of the human's files/ area; with it, the whole area
// is walked flat and paged by `?limit=` plus a key cursor passed back as
// `?cursor=`. Query params are forwarded verbatim, so both shapes (the
// directory body `{path, entries}` and the recursive body
// `{entries, nextKey}`) reach the client unchanged.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  const forwarded = new URLSearchParams();
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const path = `/api/v1/humans/${encodeURIComponent(name)}/files${qs ? `?${qs}` : ''}`;

  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
  });
}
