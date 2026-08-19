import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

// Read-only proxy for the controller's worker checkpoint read endpoints:
//   GET /api/agentteams/workers/{name}/checkpoints/{sub}
//       → Controller /api/v1/workers/{name}/checkpoints/{sub}
// sub is limited to `graph` / `status`; the Controller enforces the same
// whitelist and returns 502 "requires QwenPaw 2.1" for pre-2.1 workers.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; sub: string }> },
) {
  const { name, sub } = await params;
  if (sub !== 'graph' && sub !== 'status') {
    return Response.json({ message: 'unsupported checkpoint subpath' }, { status: 400 });
  }
  // Forward the query (notably `limit` for graph), except the internal
  // controllerUrl override consumed by getControllerUrl.
  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue;
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  // encode even though the whitelist already pins sub to graph|status —
  // defense in depth if a future sub is added without the encode
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/workers/${encodeURIComponent(name)}/checkpoints/${encodeURIComponent(sub)}${qs ? `?${qs}` : ''}`,
    { forwardBody: false },
  );
}
