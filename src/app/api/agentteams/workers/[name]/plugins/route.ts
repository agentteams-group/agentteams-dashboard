import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/workers/{name}/plugins
//
// Read-only proxy for the worker's qwenpaw plugin registry (#1526). The
// controller forwards to the worker's own `GET /api/plugins` and returns the
// pinned metadata projection only. Embedded-only upstream (503 otherwise);
// team scoping and the runtime guard live in the controller.
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/workers/${encodeURIComponent(name)}/plugins`,
    { forwardBody: false, method: 'GET' },
  );
}
