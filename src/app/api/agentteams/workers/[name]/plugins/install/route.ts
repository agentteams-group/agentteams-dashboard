import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

// POST /api/agentteams/workers/{name}/plugins/install
//
// Forwards the controller's existing worker plugin install/update endpoint
// (#1526). The controller re-reads the release index, verifies the artifact
// checksum and pushes the verified bytes to the worker. The UI requires an
// explicit confirmation before calling this route.
export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/workers/${encodeURIComponent(name)}/plugins/install`,
  );
}
