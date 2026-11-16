import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../../../proxy-helper';

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const homeserver = getMatrixHomeserver(request);
    const token = getAccessToken(request);
    const { roomId } = await params;
    return proxyToMatrix(request, homeserver, `/_matrix/client/unstable/org.agentteams/rooms/${encodeURIComponent(roomId)}/delete`, token, { method: 'POST', forwardBody: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
