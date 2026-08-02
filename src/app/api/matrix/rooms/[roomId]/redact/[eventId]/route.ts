// PUT /api/matrix/rooms/[roomId]/redact/[eventId] - Delete (redact) a message
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken } from '../../../../proxy-helper';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string; eventId: string }> }
) {
  try {
    const { roomId, eventId } = await params;
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    const body = await request.json().catch(() => ({}));
    const { reason } = body as { reason?: string };

    const txnId = `agentteams_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const encodedRoomId = encodeURIComponent(roomId);
    const encodedEventId = encodeURIComponent(eventId);
    const targetUrl = `${homeserver}/_matrix/client/v3/rooms/${encodedRoomId}/redact/${encodedEventId}/${txnId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(targetUrl, {
        method: 'PUT',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reason ? { reason } : {}),
      });

      const resultData = await res.arrayBuffer();
      const responseHeaders = new Headers();
      const resCT = res.headers.get('content-type');
      if (resCT) responseHeaders.set('content-type', resCT);

      return new NextResponse(resultData, {
        status: res.status,
        headers: responseHeaders,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
