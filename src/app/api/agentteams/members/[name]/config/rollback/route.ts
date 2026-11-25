import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

export const dynamic = 'force-dynamic';

// POST /api/agentteams/members/{name}/config/rollback?rev=<64-hex>
//
// Restores the snapshot captured before the referenced write
// (`POST /api/members/{name}/config/rollback?rev=...`, #1493). The panel keeps
// a small stack of `rev`s it replaced (pushRev) and rolls back to the newest
// one; the controller validates the rev and answers 409 when it is unknown.
//
// Status/body pass through unchanged so the client can classify stale revs and
// permission failures the same way it classifies write errors.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;

  const rev = request.nextUrl.searchParams.get('rev');
  if (!rev) {
    return NextResponse.json({ error: '缺少 rev 参数' }, { status: 400 });
  }
  const path = `/api/members/${encodeURIComponent(name)}/config/rollback?rev=${encodeURIComponent(rev)}`;
  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
    method: 'POST',
  });
}
