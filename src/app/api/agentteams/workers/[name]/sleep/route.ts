import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'sleep', 'worker', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(name)}/sleep`, { forwardBody: false, method: 'POST' });
}
