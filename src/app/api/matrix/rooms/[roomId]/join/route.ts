// POST /api/matrix/rooms/[roomId]/join - Accept a Matrix room invite.
//
// This is a write action — the proxy enforces the homeserver allowlist
// (SEC-05), rejects malformed room IDs, and emits a `matrix.invite.accept`
// audit event with the dashboard session identity so the audit page can
// attribute accept/reject actions back to a human.
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
  // Spec ref: https://spec.matrix.org/v1.10/client-server-api/#roomidoreventid
  // and POST /_matrix/client/v3/join/{roomIdOrAlias}. `rooms.invite` in
  // /sync responses may be keyed by either — alias is legal and the
  // homeserver resolves it to the underlying room id.
  //
  // Character class matches the Matrix spec's restricted grammar for the
  // opaque id part of both forms. The right-hand server part may carry a
  // `:port` suffix when the homeserver was started on a non-default port and
  // published that port inside its `server_name` (e.g. embedded Tuwunel at
  // `matrix-local.agentteams.io:18080`). Without the optional port suffix
  // the proxy rejects perfectly legal IDs from such homeservers and the
  // invite accept flow shows a misleading "M_INVALID_ROOM_ID" to the user.
  return (
    /^![A-Za-z0-9._=\/+-]+:[A-Za-z0-9.-]+(?::\d+)?$/.test(value) ||
    /^#[A-Za-z0-9._-]+:[A-Za-z0-9.-]+(?::\d+)?$/.test(value)
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
  const path = `/_matrix/client/v3/join/${encodedRoomId}`;
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
      action: 'matrix.invite.accept',
      details: `POST ${path} → upstream ${response.status}`,
      severity: response.status < 400 ? 'info' : 'warning',
      source_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });
  }
  return response;
}