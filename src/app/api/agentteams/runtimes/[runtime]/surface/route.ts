import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/runtimes/{runtime}/surface
//
// Read-only proxy for the controller's static runtime surface declaration
// (`GET /api/runtimes/{runtime}/surface`, #1493 — not under /v1). The surface
// lists every editable field of that runtime (key/type/default/applies/group)
// so the panel never invents fields.
//
// Statuses pass through unchanged: 404 for a runtime without an adapter
// (today only openclaw + hermes register one), 409 runtime_unknown on older
// controllers, 503 without an exec backend. The client renders an honest
// "endpoint unsupported" degrade instead of a blank/mock form.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runtime: string }> },
) {
  const { runtime } = await params;
  if (!isValidNameSegment(runtime)) {
    return NextResponse.json({ error: '非法运行时名' }, { status: 400 });
  }
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/runtimes/${encodeURIComponent(runtime)}/surface`,
    { forwardBody: false, method: 'GET' },
  );
}
