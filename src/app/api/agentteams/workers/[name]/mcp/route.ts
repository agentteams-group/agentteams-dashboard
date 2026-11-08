import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';
import { normalizeWorkerMcpItems } from '@/lib/worker-mcp';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/workers/{name}/mcp
//
// Read-only proxy for the worker's self-registered MCP servers. The
// controller resolves the worker, enforces the team read boundary (404, never
// 403, so worker existence cannot be probed) and forwards to the worker's own
// qwenpaw app GET /api/mcp (embedded mode only; 503 otherwise).
//
// Status codes pass through unchanged (404 = controller predates the endpoint
// or worker unreadable, 403 = no permission, 400 = non-qwenpaw runtime,
// 503 = kube mode) so the client can degrade honestly instead of pretending
// the list is empty. The 200 body is NOT passed through raw: for L1 readers
// the controller forwards env/headers verbatim, and those values can hold
// runtime-injected credentials, so this server boundary normalizes to the
// whitelist item shape (env/header KEY NAMES only, url userinfo stripped,
// home paths tidied) before the JSON reaches the browser.
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const upstream = await proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/workers/${encodeURIComponent(name)}/mcp`,
    { forwardBody: false, method: 'GET' },
  );
  if (upstream.status !== 200) return upstream;

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return NextResponse.json({ error: 'worker MCP 响应不是合法 JSON' }, { status: 502 });
  }
  return NextResponse.json({
    available: true,
    worker: name,
    items: normalizeWorkerMcpItems(payload),
  });
}
