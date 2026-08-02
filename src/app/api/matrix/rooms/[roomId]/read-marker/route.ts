// GET/PUT /api/matrix/rooms/[roomId]/read-marker - Read/set the m.fully_read account data
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../../../proxy-helper';

interface AccountDataTarget {
  homeserver: string;
  accessToken: string;
  path: string;
}

function buildAccountDataTarget(request: NextRequest, roomId: string): AccountDataTarget {
  const homeserver = getMatrixHomeserver(request);
  const accessToken = getAccessToken(request);
  const userId = request.nextUrl.searchParams.get('userId');
  if (!userId) {
    throw new Error('Missing userId parameter');
  }
  const encodedRoomId = encodeURIComponent(roomId);
  const encodedUserId = encodeURIComponent(userId);
  return {
    homeserver,
    accessToken,
    path: `/_matrix/client/v3/user/${encodedUserId}/rooms/${encodedRoomId}/account_data/m.fully_read`,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const target = buildAccountDataTarget(request, roomId);
    return await proxyToMatrix(request, target.homeserver, target.path, target.accessToken, {
      method: 'GET',
      forwardBody: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const target = buildAccountDataTarget(request, roomId);
    return await proxyToMatrix(request, target.homeserver, target.path, target.accessToken, {
      method: 'PUT',
      forwardBody: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
