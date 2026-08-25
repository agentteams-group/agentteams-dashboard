import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/teams', { forwardBody: false });
}

export async function POST(request: NextRequest) {
  const denied = await enforceServerSideRbac(request, 'create', 'team', '*');
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/teams');
}
