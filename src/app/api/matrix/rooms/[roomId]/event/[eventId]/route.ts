import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../../../../proxy-helper';

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string; eventId: string }> }) {
  try {
    const { roomId, eventId } = await params;
    return await proxyToMatrix(request, getMatrixHomeserver(request), `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`, getAccessToken(request), { method: 'GET', forwardBody: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
