// GET /api/matrix/rooms/[roomId]/messages - Get room messages
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../../../proxy-helper';
import { SESSION_RECEIPT_TYPE } from '@/lib/message-read-status';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    const dir = request.nextUrl.searchParams.get('dir') || 'b';
    const limit = request.nextUrl.searchParams.get('limit') || '50';
    const from = request.nextUrl.searchParams.get('from') || '';

    const encodedRoomId = encodeURIComponent(roomId);
    let path = `/_matrix/client/v3/rooms/${encodedRoomId}/messages?dir=${dir}&limit=${limit}`;
    path += `&filter=${encodeURIComponent(JSON.stringify({ not_types: [SESSION_RECEIPT_TYPE] }))}`;
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
