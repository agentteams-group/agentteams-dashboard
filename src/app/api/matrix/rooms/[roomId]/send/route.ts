// PUT /api/matrix/rooms/[roomId]/send - Send message to room
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken } from '../../../proxy-helper';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    const body = await request.json();
    const { msgtype = 'm.text', body: messageBody, format, formattedBody, url: mediaUrl, info, 'm.mentions': mentions } = body;

    if (!messageBody) {
      return NextResponse.json({ error: 'Missing message body' }, { status: 400 });
    }

    const txnId = `hiclaw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const encodedRoomId = encodeURIComponent(roomId);
    const targetUrl = `${homeserver}/_matrix/client/v3/rooms/${encodedRoomId}/send/m.room.message/${txnId}`;

    const messageContent: Record<string, unknown> = {
      msgtype,
      body: messageBody,
    };

    if (format && formattedBody) {
      messageContent.format = format;
      messageContent.formatted_body = formattedBody;
    }
    if (mediaUrl) {
      messageContent.url = mediaUrl;
    }
    if (info) {
      messageContent.info = info;
    }
    if (mentions) {
      messageContent['m.mentions'] = mentions;
    }

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
        body: JSON.stringify(messageContent),
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
