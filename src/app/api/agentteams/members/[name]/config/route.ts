import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

// GET /api/agentteams/members/{name}/config
//
// Proxies the controller's per-runtime member-config read end
// (`GET /api/members/{name}/config`, not under /v1). It returns the runtime's
// native config plus the reconcile verdict:
//   { runtime, rev, values, applied, pendingRestart, inactive? }
//
// The dashboard consumes it only to detect "saved but not effective" writes
// (pendingRestart / applied=pending) and offer an explicit restart. The
// controller answers 409 runtime_unknown for runtimes without a config
// manager, and 503 in kube mode / without an exec backend; both pass through
// so the panel can degrade to a neutral placeholder instead of an error.

export const dynamic = 'force-dynamic';

const pathFor = (name: string) => `/api/members/${encodeURIComponent(name)}/config`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'view', 'worker', name);
  if (denied) return denied;

  return proxyToAgentTeams(request, getControllerUrl(request), pathFor(name), {
    forwardBody: false,
    method: 'GET',
  });
}
