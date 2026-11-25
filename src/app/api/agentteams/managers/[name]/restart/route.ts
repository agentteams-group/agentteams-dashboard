import { NextRequest, NextResponse } from 'next/server';
import { isValidNameSegment } from '@/lib/skill-package';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

// POST /api/agentteams/managers/{name}/restart
//
// Proxies the controller's `POST /api/v1/managers/{name}/restart` (#1473:
// stop + start the Manager container so it re-reads its spec). The Controller
// enforces ActionUpdate on the manager resource; the Dashboard gate below is
// the same 'update' scope as PUT /managers/{name}.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Manager 名' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;

  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/managers/${encodeURIComponent(name)}/restart`,
    { forwardBody: false, method: 'POST' },
  );
}
