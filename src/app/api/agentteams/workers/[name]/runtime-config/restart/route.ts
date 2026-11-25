import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

// POST /api/agentteams/workers/{name}/runtime-config/restart
//
// Restarts the worker container so the process re-reads its config from
// scratch (`POST /api/v1/workers/{name}/restart`, upstream #1473). This is the
// explicit user action behind the dashboard's 「重启生效」 button — the
// controller never restarts a worker on its own after a config write.
//
// The distinct subpath is deliberate: `/workers/{name}/restart` already means
// the sleep→wake skill-reload flow, while this one is the controller's
// stop→start lifecycle action. Statuses pass through unchanged:
//   404 worker not found · 409 concurrent update conflict · 502 backend
//   stop/start failure · 503 no exec-capable backend.

const pathFor = (name: string) => `/api/v1/workers/${encodeURIComponent(name)}/restart`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'wake', 'worker', name);
  if (denied) return denied;

  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(name), {
    forwardBody: false,
    method: 'POST',
  });
}
