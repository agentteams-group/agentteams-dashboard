import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';

// 编码执行记录列表（#146 缺口 2，只读）：GET 透传上游
// `GET /api/v1/coding-runs`。响应结构为 [{task_id, run, team?}]，已由上游按
// 调用方可读的存储前缀（L1 全量 / L2 本团队）过滤——过滤在服务端，前端不重复。
// 只读端点，无审计（chats / checkpoints 一致先例）。404 / 空数组 = 旧 Controller
// 或无可读记录 → 前端占位/空态，不报错。

export async function GET(request: NextRequest) {
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(request, controllerUrl, '/api/v1/coding-runs', {
    forwardBody: false,
    method: 'GET',
  });
}
