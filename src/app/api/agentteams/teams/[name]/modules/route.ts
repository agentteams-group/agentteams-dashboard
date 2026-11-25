import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/teams/{name}/modules
//
// Read-only proxy for the team's aggregated module registry (#1526). The
// controller expands the team's workerMembers and returns one row per module
// with per-member versions, a `consistent` flag and per-worker errors. Team
// scoping is enforced by the controller (out-of-scope callers see 404).
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/teams/${encodeURIComponent(name)}/modules`,
    { forwardBody: false, method: 'GET' },
  );
}
