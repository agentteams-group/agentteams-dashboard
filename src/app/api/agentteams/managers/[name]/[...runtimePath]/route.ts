import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';
import { enforceServerSideRbac } from '@/lib/server-auth';

async function handle(request: NextRequest, { params }: { params: Promise<{ name: string; runtimePath: string[] }> }) {
  const { name, runtimePath } = await params;
  const subpath = runtimePath.join('/');
  if (!isValidNameSegment(name) || !(
    ['runtime-config', 'loops', 'loops/status', 'loops/custom'].includes(subpath)
    || (runtimePath.length === 3 && runtimePath[0] === 'loops' && runtimePath[1] === 'custom' && isValidNameSegment(runtimePath[2]))
  )) return NextResponse.json({ error: '不支持的助手配置路径' }, { status: 400 });
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/managers/${encodeURIComponent(name)}/${runtimePath.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, {
    method: request.method,
    forwardBody: request.method !== 'GET',
    ifMatch: request.headers.get('If-Match'),
    passthroughHeaders: ['etag'],
  });
}

export { handle as GET, handle as PUT, handle as POST, handle as DELETE };
