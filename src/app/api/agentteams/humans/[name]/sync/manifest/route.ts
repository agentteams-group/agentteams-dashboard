import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/humans/{name}/sync/manifest
//
// Read-only proxy for the stored sync manifest (#1499). The controller
// returns the manifest body verbatim plus its storage ETag; the ETag is the
// write base the file-sync client needs, so it is forwarded. Manifest writes
// (PUT If-Match / If-None-Match) are deliberately not exposed here — the
// dashboard only displays sync state.
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/humans/${encodeURIComponent(name)}/sync/manifest`,
    {
      forwardBody: false,
      method: 'GET',
      passthroughHeaders: ['etag'],
    },
  );
}
