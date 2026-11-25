import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

// POST /api/agentteams/managers/{name}/plugins/install
//
// Forwards the controller's existing manager plugin install/update endpoint
// (#1526). Managers use the same dashboard RBAC resource kind as the manager
// PUT route ('team'), while the controller authorizes on the manager. The UI
// requires an explicit confirmation before calling this route.
export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/managers/${encodeURIComponent(name)}/plugins/install`,
  );
}
