import { NextRequest, NextResponse } from 'next/server';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; name: string }> }) {
  const denied = await enforceLevelOnlyRbac(request, 'manage', 'monitoring', '*');
  if (denied) return denied;
  const { kind, name } = await params;
  if (!['worker', 'manager', 'component'].includes(kind) || !isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法监控资源' }, { status: 400 });
  }
  const query = new URLSearchParams();
  for (const key of ['tail', 'since']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }
  const response = await proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/monitoring/${kind}/${encodeURIComponent(name)}/logs?${query}`, { forwardBody: false });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
