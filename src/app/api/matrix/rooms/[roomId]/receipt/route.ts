// POST /api/matrix/rooms/[roomId]/receipt - Send an m.read receipt for a message
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../../../proxy-helper';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    const body = await request.json();
    const eventId = typeof body?.eventId === 'string' ? body.eventId : null;
    if (!eventId) {
      return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
    }

    const encodedRoomId = encodeURIComponent(roomId);
    const encodedEventId = encodeURIComponent(eventId);
    const path = `/_matrix/client/v3/rooms/${encodedRoomId}/receipt/m.read/${encodedEventId}`;
    return await proxyToMatrix(request, homeserver, path, accessToken, {
      method: 'POST',
      forwardBody: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
