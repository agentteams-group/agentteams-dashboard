import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';

// B7 worker Coding CLI 探测（#1360 消费）。
// GET 透传；旧 Controller / L2 跨团队隐藏 → 404 → 前端占位横幅。
// 嵌套 settings/install 见 [..rest]/route.ts（固定路径白名单，禁通用反代）。

const pathFor = (name: string) => `/api/v1/workers/${encodeURIComponent(name)}/coding-cli`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(request, controllerUrl, pathFor(name), {
    forwardBody: false,
    method: 'GET',
  });
}
