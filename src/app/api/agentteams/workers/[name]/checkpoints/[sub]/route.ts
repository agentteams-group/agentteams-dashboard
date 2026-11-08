import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';

// Worker 检查点只读代理（Controller worker_checkpoints.go）：
//   GET /api/v1/workers/{name}/checkpoints/graph?limit=
//   GET /api/v1/workers/{name}/checkpoints/status
// 语义（与 chats/tools 同型）：状态码原样回传——
//   404/405 = 旧 Controller 无该路由（能力缺口，前端隐藏/占位）
//   403     = L2 不在该 Worker 团队（W8 不可探测）
//   502     = QwenPaw < 2.1 / worker 容器不可达
//   503     = 非 embedded 模式
// 只读端点，无审计（chats 一致先例）。

const SUB_WHITELIST = new Set(['graph', 'status']);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; sub: string }> },
) {
  const { name, sub } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  if (!SUB_WHITELIST.has(sub)) {
    return NextResponse.json({ error: `不支持的子路径：${sub}` }, { status: 400 });
  }
  // graph 白名单只有 limit；其余参数由上游拒绝（薄透传，不重复实现）。
  const search = sub === 'graph' ? request.nextUrl.search : '';
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(
    request,
    controllerUrl,
    `/api/v1/workers/${encodeURIComponent(name)}/checkpoints/${sub}${search}`,
    { forwardBody: false, method: 'GET' },
  );
}
