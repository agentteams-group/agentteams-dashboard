import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/gateway/consumers', { forwardBody: false });
}

export async function POST(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'create', 'gateway.consumer', 'new');
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/gateway/consumers');
}
