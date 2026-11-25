import { NextRequest } from 'next/server';
import { requireHigressConsoleAccess } from '../../../higress/access';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';

async function forward(request: NextRequest, method: 'GET' | 'PUT') {
  const denied = await requireHigressConsoleAccess(request);
  if (denied) return denied;
  const response = await proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/gateway/model-probe-policy', { method, forwardBody: method === 'PUT' });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export async function GET(request: NextRequest) { return forward(request, 'GET'); }
export async function PUT(request: NextRequest) { return forward(request, 'PUT'); }
