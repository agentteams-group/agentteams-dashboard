import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../agentteams/proxy-helper';

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const controller = getControllerUrl(request);
    const { roomId } = await params;
    return proxyToAgentTeams(request, controller, `/api/v1/task-rooms/${encodeURIComponent(roomId)}/unarchive`, { method: 'POST', forwardBody: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
