import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';

// GET /api/agentteams/setup/status - Return the controller's persisted setup state.
export async function GET(request: NextRequest) {
  const controllerUrl = getControllerUrl(request);
  const res = await proxyToAgentTeams(request, controllerUrl, '/api/v1/setup/status', {
    method: 'GET',
    forwardBody: false,
  });

  // Controllers that predate (or never shipped) /setup/status answer 404 —
  // some gateways answer 405/501 for the unknown path. That is a normal
  // "nothing to set up" state, not a dashboard error: return a 200 degraded
  // payload so the page does not log/propagate a 404 on every load.
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    return NextResponse.json({ setupRequired: false, degraded: true });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Failed to load setup status');
    return NextResponse.json({ error: text }, { status: res.status });
  }

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data);
}
