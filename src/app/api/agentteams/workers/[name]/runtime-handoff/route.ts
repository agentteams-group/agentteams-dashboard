import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

async function handoff(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!isValidNameSegment(name)) return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  const write = request.method === 'POST';
  const denied = await enforceServerSideRbac(request, write ? 'update' : 'view', 'worker', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(name)}/runtime-handoff`, {
    method: request.method,
    forwardBody: write,
    forwardRequestHeaders: write ? ['If-Match', 'If-None-Match'] : [],
    passthroughHeaders: ['etag'],
  });
}

export { handoff as GET, handoff as POST };
