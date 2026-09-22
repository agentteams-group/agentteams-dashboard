// POST /api/matrix/rooms/[roomId]/leave - Reject or leave a Matrix room.
//
// Sister route to /join — same allowlist enforcement and audit hooks, but
// tags the action as `matrix.invite.reject` so the audit page can group
// accept/reject flows together.
import { NextRequest, NextResponse } from 'next/server';
import { HomeserverValidationError } from '@/lib/homeserver-allowlist';
import { appendAuditEvent } from '@/lib/audit-log';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import {
  getMatrixHomeserver,
  getAccessToken,
  proxyToMatrix,
} from '../../../proxy-helper';

function isRoomId(value: string): boolean {
  // Matrix room identifiers come in two legal forms:
  //   !opaque:server          — full room id (always non-empty)
  //   #roomalias:server       — room alias; POST /join accepts both
  // See the matching note in the /join route — we accept the same shapes
  // here so the invite-ingest path (which may snapshot an alias) round-
  // trips through the proxy without a 400.
  return (
    /^![A-Za-z0-9._=/+-]+:[A-Za-z0-9.-]+$/.test(value) ||
    /^#[A-Za-z0-9._-]+:[A-Za-z0-9.-]+$/.test(value)
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  let homeserver: string;
  let accessToken: string;
  let roomId: string;
  try {
    roomId = (await params).roomId;
    if (!isRoomId(roomId)) {
      return NextResponse.json({ errcode: 'M_INVALID_ROOM_ID', error: 'invalid room id' }, { status: 400 });
    }
    homeserver = getMatrixHomeserver(request);
    accessToken = getAccessToken(request);
  } catch (err) {
    if (err instanceof HomeserverValidationError) {
      return NextResponse.json({ errcode: 'M_FORBIDDEN', error: err.reason }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const session = getSessionFromRequest(request);
  const encodedRoomId = encodeURIComponent(roomId);
  const path = `/_matrix/client/v3/rooms/${encodedRoomId}/leave`;
  const response = await proxyToMatrix(request, homeserver, path, accessToken, {
    method: 'POST',
    forwardBody: false,
  });

  if (session) {
    void appendAuditEvent({
      actor: session.user,
      actor_level: session.level,
      entity_type: 'system',
      entity_name: roomId,
      action: 'matrix.invite.reject',
      details: `POST ${path} → upstream ${response.status}`,
      severity: response.status < 400 ? 'info' : 'warning',
      source_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });
  }
  return response;
}