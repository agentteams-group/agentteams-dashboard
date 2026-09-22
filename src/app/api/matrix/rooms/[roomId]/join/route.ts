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
  // Matrix room IDs are `!opaque:server` for normal rooms; we also allow
  // the older legacy `[irc]` form to fail closed rather than forward to
  // a homeserver that will reject it anyway.
  return /^![A-Za-z0-9._=/+-]+:[A-Za-z0-9.-]+$/.test(value);
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
      actor: session.userId,
      actor_level: session.level,
      entity_type: 'system',
      entity_name: roomId,
      action: 'matrix.invite.accept',
      details: `POST ${path} → upstream ${response.status}`,
      severity: response.status < 400 ? 'info' : 'warning',
      source_ip: session.sourceIp,
    });
  }
  return response;
}