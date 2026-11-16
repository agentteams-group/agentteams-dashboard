import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../agentteams/proxy-helper';

export async function GET(request: NextRequest) {
  try {
    const controller = getControllerUrl(request);
    const query = new URLSearchParams();
    for (const key of ['team', 'team_admin', 'human_member']) {
      const value = request.nextUrl.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const response = await proxyToAgentTeams(request, controller, `/api/v1/task-rooms/archived?${query}`, { method: 'GET', forwardBody: false });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
