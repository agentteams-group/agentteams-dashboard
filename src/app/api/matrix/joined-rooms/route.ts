// GET /api/matrix/joined-rooms - Rooms joined by the current Matrix session.
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../proxy-helper';

export async function GET(request: NextRequest) {
  try {
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);
    const response = await proxyToMatrix(request, homeserver, '/_matrix/client/v3/joined_rooms', accessToken, {
      method: 'GET',
      forwardBody: false,
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
