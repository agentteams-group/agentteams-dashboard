import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';

// QwenPaw loop-mode catalog (worker runtime config → Loop 模式).
//   GET /api/v1/workers/{name}/loops
// Read-only; 404 = old controller / unknown worker → the panel degrades to
// "loop 模式不可用" instead of failing the whole config form.

const pathFor = (name: string) => `/api/v1/workers/${encodeURIComponent(name)}/loops`;

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
