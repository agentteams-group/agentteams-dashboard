import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

// POST /api/agentteams/teams/{name}/modules/{module}/install
//
// Forwards the controller's existing team module install/update endpoint
// (#1526). The dashboard UI shows a confirmation dialog before calling this;
// the controller re-reads the release index, verifies the artifact checksum
// and rolls the module through every team member.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; module: string }> },
) {
  const { name, module } = await params;
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/teams/${encodeURIComponent(name)}/modules/${encodeURIComponent(module)}/install`,
  );
}
