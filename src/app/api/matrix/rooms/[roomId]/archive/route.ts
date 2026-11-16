import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../agentteams/proxy-helper';

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const controller = getControllerUrl(request);
    const { roomId } = await params;
    return proxyToAgentTeams(request, controller, `/api/v1/task-rooms/${encodeURIComponent(roomId)}/archive`, { method: 'POST', forwardBody: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/task-rooms/${encodeURIComponent(roomId)}/archive`, { method: 'GET', forwardBody: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}

