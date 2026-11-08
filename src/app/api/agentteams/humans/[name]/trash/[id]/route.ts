import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// DELETE /api/agentteams/humans/{name}/trash/{id}
//
// 彻底删除回收站条目（human_files_handler.go purgeTrash）。admin only，
// 非 admin → Controller 403。
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; id: string }> },
) {
  const { name, id } = await params;
  const upstream = `/api/v1/humans/${encodeURIComponent(name)}/trash/${encodeURIComponent(id)}`;
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    method: 'DELETE',
    forwardBody: false,
  });
}
