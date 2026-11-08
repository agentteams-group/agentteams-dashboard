import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/managers/{name}/plugins
//
// Read-only proxy for the manager's qwenpaw plugin registry (#1526). Managers
// are cluster-level resources with no team boundary; the controller's manager
// authz is the scope. Embedded-only upstream (503 otherwise).
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/managers/${encodeURIComponent(name)}/plugins`,
    { forwardBody: false, method: 'GET' },
  );
}
