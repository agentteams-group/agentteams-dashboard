import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceLevelOnlyRbac(request, 'update', 'gateway.consumer', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(name)}/gateway-probe`);
}
