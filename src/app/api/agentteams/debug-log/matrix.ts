// Matrix message export — mirrors the Matrix section of export-debug-log.py.
// Talks to the homeserver directly (server-side) using the browser-supplied
// access token; the homeserver URL is validated against the allowlist first.

import { validateHomeserverUrl } from '@/lib/homeserver-allowlist';
import { redactJsonStrings } from './redact';

const REQUEST_TIMEOUT_MS = 30000;

export interface MatrixExportResult {
  rooms: number;
  messages: number;
  files: Record<string, string>;
  error?: string;
}

interface MatrixEvent {
  event_id?: string;
  type?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: Record<string, unknown>;
}

async function matrixApi(
  homeserver: string,
  token: string,
  endpoint: string,
  params?: Record<string, string>
): Promise<Record<string, unknown>> {
  let url = `${homeserver.replace(/\/$/, '')}/_matrix/client/v3/${endpoint}`;
  if (params) {
    url += `?${new URLSearchParams(params).toString()}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Matrix API ${res.status} on ${endpoint}: ${body}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRoomMessages(
  homeserver: string,
  token: string,
  roomId: string,
  sinceTsMs: number
): Promise<MatrixEvent[]> {
  const encoded = encodeURIComponent(roomId);
  const messages: MatrixEvent[] = [];
  let fromToken = '';

  for (;;) {
    const params: Record<string, string> = { dir: 'b', limit: '100' };
    if (fromToken) params.from = fromToken;
    const data = await matrixApi(homeserver, token, `rooms/${encoded}/messages`, params);
    const chunk = (data.chunk as MatrixEvent[] | undefined) ?? [];
    if (chunk.length === 0) break;

    let hitBoundary = false;
    for (const event of chunk) {
      if ((event.origin_server_ts ?? 0) < sinceTsMs) {
        hitBoundary = true;
        break;
      }
      messages.push(event);
    }
    if (hitBoundary) break;

    const nextToken = data.end as string | undefined;
    if (!nextToken || nextToken === fromToken) break;
    fromToken = nextToken;
  }

  messages.reverse();
  return messages;
}

function formatEvent(event: MatrixEvent, redact: boolean): Record<string, unknown> {
  const content = event.content ?? {};
  const ts = event.origin_server_ts ?? 0;
  const record: Record<string, unknown> = {
    event_id: event.event_id,
    type: event.type,
    sender: event.sender,
    timestamp: ts,
    time: new Date(ts).toISOString(),
  };
  if (event.type === 'm.room.message') {
    record.msgtype = content.msgtype;
    record.body = content.body;
    if (content.format) record.format = content.format;
    if (content.url) record.url = content.url;
    if (content['m.relates_to']) record.relates_to = content['m.relates_to'];
  } else {
    record.content = content;
  }
  return redact ? redactJsonStrings(record) : record;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\-. ]/g, '_').trim().slice(0, 80);
}

export async function exportMatrixMessages(options: {
  homeserver: string;
  token: string;
  sinceEpochSec: number;
  redact: boolean;
  roomFilter?: string;
  messagesOnly?: boolean;
  stop?: () => boolean;
}): Promise<MatrixExportResult> {
  const { homeserver, token, sinceEpochSec, redact, roomFilter, messagesOnly, stop } = options;

  // Defense in depth: the homeserver must pass the same allowlist / SSRF
  // checks as the regular Matrix proxy routes. requireAllowlist additionally
  // refuses to forward the user's access token to any public host that is not
  // on the (built-in or configured) allowlist.
  validateHomeserverUrl(homeserver, { requireAllowlist: true });

  const result: MatrixExportResult = { rooms: 0, messages: 0, files: {} };

  let rooms: string[] = [];
  try {
    const data = await matrixApi(homeserver, token, 'joined_rooms');
    rooms = (data.joined_rooms as string[] | undefined) ?? [];
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Failed to list joined rooms';
    return result;
  }

  const sinceTsMs = Math.floor(sinceEpochSec * 1000);

  for (const roomId of rooms) {
    if (stop?.()) break;
    let roomName = '';
    try {
      const data = await matrixApi(
        homeserver,
        token,
        `rooms/${encodeURIComponent(roomId)}/state/m.room.name`
      );
      roomName = (data.name as string) ?? '';
    } catch {
      roomName = '';
    }

    if (roomFilter && !roomId.includes(roomFilter) && !roomName.includes(roomFilter)) {
      continue;
    }

    let events: MatrixEvent[] = [];
    try {
      events = await fetchRoomMessages(homeserver, token, roomId, sinceTsMs);
    } catch {
      continue; // Skip rooms we cannot read (e.g. permission errors).
    }
    if (messagesOnly) {
      events = events.filter((e) => e.type === 'm.room.message');
    }
    if (events.length === 0) continue;

    const namePart = roomName ? sanitizeFilename(roomName) : '';
    const idPart = sanitizeFilename(roomId);
    const filename = namePart ? `${namePart}_${idPart}.jsonl` : `${idPart}.jsonl`;

    const lines = events.map((e) => JSON.stringify(formatEvent(e, redact)));
    result.files[`matrix-messages/${filename}`] = lines.join('\n') + '\n';
    result.rooms += 1;
    result.messages += events.length;
  }

  return result;
}
