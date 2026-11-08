import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

// QwenPaw custom loop modes (worker runtime config → Loop 模式 · 自定义).
//   GET  /api/v1/workers/{name}/loops/custom
//   POST /api/v1/workers/{name}/loops/custom   (201; 409 duplicate id/slash;
//                                               422 invalid pipeline)
// PUT/DELETE per mode live in ./[mode]/route.ts.

const pathFor = (name: string) => `/api/v1/workers/${encodeURIComponent(name)}/loops/custom`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(name), {
    forwardBody: false,
    method: 'GET',
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(name), {
    forwardBody: true,
    method: 'POST',
  });
}
