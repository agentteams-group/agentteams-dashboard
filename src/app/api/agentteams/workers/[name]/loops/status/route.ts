import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';

// Worker 激活 loop 状态（抽屉状态卡的 loop 预算行）：
//   GET /api/v1/workers/{name}/loops/status?session_id=matrix:{roomID}
// 404（旧 Controller / 无该 session）→ 原样回传，前端整行不显（诚实降级）。
// 只读端点，无审计。

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const sessionId = request.nextUrl.searchParams.get('session_id') ?? '';
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id 必填' }, { status: 400 });
  }
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(
    request,
    controllerUrl,
    `/api/v1/workers/${encodeURIComponent(name)}/loops/status?session_id=${encodeURIComponent(sessionId)}`,
    { forwardBody: false, method: 'GET' },
  );
}
