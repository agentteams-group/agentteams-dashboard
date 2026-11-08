import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/model-access-tables → controller GET /api/v1/model-access-tables
// 共享模型授权表清单。404 = 旧 Controller 无此能力（前端隐藏表选择器）。
export async function GET(request: NextRequest) {
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    '/api/v1/model-access-tables',
    { forwardBody: false, method: 'GET' },
  );
}
