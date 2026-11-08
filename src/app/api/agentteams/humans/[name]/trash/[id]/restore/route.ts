import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// POST /api/agentteams/humans/{name}/trash/{id}/restore[?overwrite=1]
//
// 回收站恢复（human_files_handler.go restoreTrash）。目标路径已存在 → 409；
// admin 可用 ?overwrite=1 覆盖恢复。权限由 Controller 终裁。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; id: string }> },
) {
  const { name, id } = await params;
  const forwarded = new URLSearchParams();
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key !== 'controllerUrl') forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const upstream = `/api/v1/humans/${encodeURIComponent(name)}/trash/${encodeURIComponent(id)}/restore${
    qs ? `?${qs}` : ''
  }`;
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    method: 'POST',
    forwardBody: false,
  });
}
