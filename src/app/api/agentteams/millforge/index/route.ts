import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/millforge/index
//
// Read-only proxy for the Millforge release index (#1526): the controller
// fetches `releases/<channel>/channels.json` from an allowlisted raw-content
// host, validates the envelope, and re-serves `{schema, channel, modules,
// source, repo, fetched_at}`. Query parameters (source/repo/ref/channel) are
// forwarded verbatim; the controller 400s invalid combinations.
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/millforge/index${qs ? `?${qs}` : ''}`,
    { forwardBody: false, method: 'GET' },
  );
}
