import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

// QwenPaw custom loop mode (whole-object replace / delete).
//   PUT    /api/v1/workers/{name}/loops/custom/{mode}  (body.id must equal
//                                                       {mode}, else 422)
//   DELETE /api/v1/workers/{name}/loops/custom/{mode}  (204; 404 not found)

const pathFor = (name: string, mode: string) =>
  `/api/v1/workers/${encodeURIComponent(name)}/loops/custom/${encodeURIComponent(mode)}`;

async function guard(request: NextRequest, name: string, mode: string) {
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  if (!isValidNameSegment(mode)) {
    return NextResponse.json({ error: '非法 loop 模式 ID' }, { status: 400 });
  }
  return enforceServerSideRbac(request, 'update', 'worker', name);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; mode: string }> },
) {
  const { name, mode } = await params;
  const denied = await guard(request, name, mode);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(name, mode), {
    forwardBody: true,
    method: 'PUT',
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; mode: string }> },
) {
  const { name, mode } = await params;
  const denied = await guard(request, name, mode);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(name, mode), {
    forwardBody: false,
    method: 'DELETE',
  });
}
