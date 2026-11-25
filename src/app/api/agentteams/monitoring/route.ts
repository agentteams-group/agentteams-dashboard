import { NextRequest } from 'next/server';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';

export async function GET(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'manage', 'monitoring', '*');
  if (denied) return denied;
  const query = new URLSearchParams();
  for (const key of ['page', 'limit', 'search']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }
  const response = await proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/monitoring?${query}`, { forwardBody: false });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
