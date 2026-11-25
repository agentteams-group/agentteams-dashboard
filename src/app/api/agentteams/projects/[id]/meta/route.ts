import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET/PUT /api/agentteams/projects/{id}/meta
//
// Proxies the controller's project meta.json endpoint (project_handler.go):
//   GET 200 = meta.json 原文（不重排）+ ETag 响应头（透传给浏览器）
//   PUT 必带 If-Match（缺失 → 428；不匹配 → 409 {"code":"conflict"}），
//       200 → 新内容 ETag
// 405（老 Controller 路由未部署）/ 404 / 409 均原样透传，前端据此隐藏
// 入口或提示冲突。

const pathFor = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}/meta`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(id), {
    forwardBody: false,
    // ETag 是编辑器的并发写基线（If-Match），必须原样回到浏览器。
    passthroughHeaders: ['etag'],
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(id), {
    method: 'PUT',
    ifMatch: request.headers.get('if-match'),
    passthroughHeaders: ['etag'],
  });
}
