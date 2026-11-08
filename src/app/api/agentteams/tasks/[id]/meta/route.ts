import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET/PUT /api/agentteams/tasks/{id}/meta
//
// Proxies the controller's task meta endpoint (task_meta_commit.go), same
// contract as the project endpoint:
//   GET 200 = meta.json 原文（不重排）+ ETag
//   PUT 必带 If-Match（缺失 → 428；不匹配 → 409 {"code":"conflict"}）
//   ?team=<team> 消歧：同一 task id 存在于多个团队时 409
//   {"code":"ambiguous_task"}，带 ?team= 重试。
// 405（老 Controller 未部署）/ 404 / 409 原样透传。

const pathFor = (id: string) => `/api/v1/tasks/${encodeURIComponent(id)}/meta`;

/** 透传 ?team=（消歧键）等查询参数，略过内部 controllerUrl 覆盖。 */
function forwardedQuery(request: NextRequest): string {
  const forwarded = new URLSearchParams();
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key === 'controllerUrl') continue;
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  return qs ? `?${qs}` : '';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `${pathFor(id)}${forwardedQuery(request)}`,
    {
      forwardBody: false,
      // ETag 是编辑器的并发写基线（If-Match）。
      passthroughHeaders: ['etag'],
    },
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `${pathFor(id)}${forwardedQuery(request)}`,
    {
      method: 'PUT',
      ifMatch: request.headers.get('if-match'),
      passthroughHeaders: ['etag'],
    },
  );
}
