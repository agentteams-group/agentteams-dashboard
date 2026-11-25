import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const response = await proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(name)}/health`, { forwardBody: false, method: 'GET' });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
