import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';
import { readServerIdentity } from '@/lib/server-auth';

// Preserve the caller's credential; the Controller resolves the actual Human,
// role, recipient room and revision. Never accept a client-supplied recipient.
async function forward(request: NextRequest) {
  if (!readServerIdentity(request)) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const scope = new URLSearchParams();
  for (const name of ['team', 'manager']) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) scope.set(name, value);
  }
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/assistant/context?${scope}`, { forwardBody: request.method === 'PUT' });
}

export const GET = forward;
export const PUT = forward;
