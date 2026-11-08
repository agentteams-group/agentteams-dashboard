import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET/PUT /api/agentteams/humans/{name}/quota
//
// 文件区配额（human_files_handler.go getQuota / putQuota）。quotaBytes null =
// 不限；0 = 零额度。PUT admin only（Controller 终裁 403）。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const upstream = `/api/v1/humans/${encodeURIComponent(name)}/quota`;
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    forwardBody: false,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const upstream = `/api/v1/humans/${encodeURIComponent(name)}/quota`;
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    method: 'PUT',
  });
}
