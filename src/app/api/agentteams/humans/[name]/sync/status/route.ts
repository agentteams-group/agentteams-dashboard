import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/humans/{name}/sync/status
//
// Read-only proxy for the controller's per-human sync summary (#1499):
// generation, last update, entry/tombstone counts. A missing manifest is a
// 200 zero summary; an older Controller answers 404/405, which the UI
// degrades to an empty state. The dashboard never writes the manifest.
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/humans/${encodeURIComponent(name)}/sync/status`,
    { forwardBody: false, method: 'GET' },
  );
}
