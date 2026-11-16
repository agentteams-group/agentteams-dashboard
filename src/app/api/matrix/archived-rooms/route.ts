import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../proxy-helper';

export async function GET(request: NextRequest) {
  try {
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);
    const query = new URLSearchParams();
    for (const key of ['team', 'team_admin', 'human_member']) {
      const value = request.nextUrl.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const response = await proxyToMatrix(request, homeserver, `/_matrix/client/unstable/org.agentteams/rooms/archived?${query}`, accessToken, { method: 'GET', forwardBody: false });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
