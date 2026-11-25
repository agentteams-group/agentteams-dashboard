import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  const team = request.nextUrl.searchParams.get('team');
  if (team) params.set('team', team);
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/tasks${params.size ? `?${params}` : ''}`, { forwardBody: false });
}
