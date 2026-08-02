// GET /api/matrix/rooms/[roomId]/relations/[eventId]/[relType] - Get message relations (e.g. m.thread replies)
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../../../../../proxy-helper';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string; eventId: string; relType: string }> }
) {
  try {
    const { roomId, eventId, relType } = await params;
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    const limit = request.nextUrl.searchParams.get('limit') || '30';
    const from = request.nextUrl.searchParams.get('from') || '';

    const encodedRoomId = encodeURIComponent(roomId);
    const encodedEventId = encodeURIComponent(eventId);
    const encodedRelType = encodeURIComponent(relType);
    let path = `/_matrix/client/v1/rooms/${encodedRoomId}/relations/${encodedEventId}/${encodedRelType}?limit=${limit}&dir=b`;
    if (from) path += `&from=${encodeURIComponent(from)}`;

    return await proxyToMatrix(request, homeserver, path, accessToken, {
      method: 'GET',
      forwardBody: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
