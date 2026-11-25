import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { assignAvatarAfterCreate } from '@/lib/avatar-storage';

export async function GET(request: NextRequest) {
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/humans', { forwardBody: false });
}

export async function POST(request: NextRequest) {
  const denied = await enforceServerSideRbac(request, 'create', 'team', '*');
  if (denied) return denied;
  const response = await proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/humans');
  await assignAvatarAfterCreate(response, 'human');
  return response;
}
