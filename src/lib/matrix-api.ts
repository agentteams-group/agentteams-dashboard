// Matrix Client-Server API Client
// All requests go through Next.js API proxy routes to the Matrix homeserver

import { apiUrl } from '@/lib/api-base';

export interface MatrixLoginResponse {
  access_token: string;
  user_id: string;
  home_server: string;
  device_id: string;
}

export interface MatrixEvent {
  event_id: string;
  sender: string;
  content: {
    msgtype?: string;
    body?: unknown;
    format?: string;
    formatted_body?: string;
    membership?: string;
    displayname?: string;
    avatar_url?: string;
    name?: string;
    topic?: string;
    url?: string;
    info?: { mimetype?: string; size?: number; w?: number; h?: number };
    user_ids?: string[];
  } & Record<string, unknown>;
  type: string;
  origin_server_ts: number;
  state_key?: string;
  unsigned?: Record<string, unknown>;
}

export interface MatrixJoinedRoom {
  timeline: {
    events: MatrixEvent[];
    limited: boolean;
    prev_batch: string;
  };
  state: {
    events: MatrixEvent[];
  };
  ephemeral?: {
    events: MatrixEvent[];
  };
  summary: {
    heroes?: string[];
    joined_member_count?: number;
    invited_member_count?: number;
  };
  unread_notifications?: {
    highlight_count: number;
    notification_count: number;
  };
}

export interface MatrixSyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, MatrixJoinedRoom>;
    invite?: Record<string, unknown>;
    leave?: Record<string, unknown>;
  };
  presence?: { events: MatrixEvent[] };
  account_data?: { events: MatrixEvent[] };
  ephemeral?: { events: MatrixEvent[] };
}

export interface MatrixMessagesResponse {
  chunk: MatrixEvent[];
  start: string;
  end: string;
}

export interface MatrixRelationsResponse {
  chunk: MatrixEvent[];
  next_batch?: string;
}

export interface MatrixReadMarker {
  event_id?: string;
  /** Server timestamp of the last read event, if known. */
  origin_server_ts?: number;
}

export interface MatrixMembersResponse {
  chunk: MatrixEvent[];
}

export interface MatrixJoinedRoomsResponse {
  joined_rooms: string[];
}

export interface MatrixRoomStateEvent {
  event_id?: string;
  type: string;
  state_key: string;
  content: Record<string, unknown>;
  sender?: string;
}

function buildHeaders(accessToken?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

function buildMatrixUrl(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const qs = search.toString();
  const base = apiUrl(path);
  return qs ? `${base}?${qs}` : base;
}

async function throwIfNotOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  const errcode = typeof data.errcode === 'string' ? data.errcode : undefined;
  const error = typeof data.error === 'string' ? data.error : fallback;
  const retryAfterMs =
    typeof data.retry_after_ms === 'number'
      ? data.retry_after_ms
      : typeof data.retry_after_ms === 'string'
        ? Number(data.retry_after_ms)
        : undefined;
  throw new MatrixRequestError(error, errcode, res.status, retryAfterMs);
}

/**
 * Structured Matrix Client-Server error. Carries the standard `errcode`
 * (e.g. M_LIMIT_EXCEEDED), the HTTP status and — when the homeserver throttles
 * the client — the suggested `retry_after_ms` so the UI can surface a
 * "rate limited, retry in Ns" hint inside the conversation.
 */
export class MatrixRequestError extends Error {
  readonly errcode: string | undefined;
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, errcode: string | undefined, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'MatrixRequestError';
    this.errcode = errcode;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  get isRateLimited(): boolean {
    return this.errcode === 'M_LIMIT_EXCEEDED' || this.status === 429;
  }
}

/**
 * Number of milliseconds until the rate limit lifts, bounded to a sane window
 * so the UI never shows a multi-hour countdown. Falls back to a 30s default.
 */
export function getRateLimitRetryDelay(err: unknown): number {
  if (err instanceof MatrixRequestError && err.isRateLimited && err.retryAfterMs) {
    return Math.min(err.retryAfterMs, 5 * 60 * 1000);
  }
  return 30 * 1000;
}

export const matrixApi = {
  login: async (homeserver: string, username: string, password: string): Promise<MatrixLoginResponse> => {
    const res = await fetch(apiUrl('/api/matrix/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeserver, username, password }),
    });
    await throwIfNotOk(res, 'Login failed');
    return res.json();
  },

  sync: async (homeserver: string, accessToken: string, since?: string, timeout = 30000): Promise<MatrixSyncResponse> => {
    const url = buildMatrixUrl('/api/matrix/sync', { homeserver, timeout, since });
    const res = await fetch(url, { headers: buildHeaders(accessToken) });
    await throwIfNotOk(res, 'Sync failed');
    return res.json();
  },

  getJoinedRooms: async (homeserver: string, accessToken: string): Promise<MatrixJoinedRoomsResponse> => {
    const url = buildMatrixUrl('/api/matrix/joined-rooms', { homeserver });
    const res = await fetch(url, { headers: buildHeaders(accessToken) });
    await throwIfNotOk(res, 'Failed to get joined rooms');
    return res.json();
  },

  getRoomMessages: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    options: { dir?: string; limit?: number; from?: string } = {}
  ): Promise<MatrixMessagesResponse> => {
    const url = buildMatrixUrl(
      `/api/matrix/rooms/${encodeURIComponent(roomId)}/messages`,
      { homeserver, dir: options.dir || 'b', limit: options.limit || 50, from: options.from }
    );
    const res = await fetch(url, { headers: buildHeaders(accessToken) });
    await throwIfNotOk(res, 'Failed to get messages');
    return res.json();
  },

  getRoomRelations: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    eventId: string,
    relType = 'm.thread',
    options: { limit?: number; from?: string } = {}
  ): Promise<MatrixRelationsResponse> => {
    const url = buildMatrixUrl(
      `/api/matrix/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(eventId)}/${relType}`,
      { homeserver, limit: options.limit || 30, from: options.from }
    );
    const res = await fetch(url, { headers: buildHeaders(accessToken) });
    await throwIfNotOk(res, 'Failed to get thread relations');
    return res.json();
  },

  getReadMarker: async (
    homeserver: string,
    accessToken: string,
    userId: string,
    roomId: string
  ): Promise<MatrixReadMarker> => {
    const url = buildMatrixUrl(
      `/api/matrix/rooms/${encodeURIComponent(roomId)}/read-marker`,
      { homeserver, userId }
    );
    const res = await fetch(url, { headers: buildHeaders(accessToken) });
    await throwIfNotOk(res, 'Failed to get read marker');
    return res.json();
  },

  setReadMarker: async (
    homeserver: string,
    accessToken: string,
    userId: string,
    roomId: string,
    eventId: string
  ): Promise<void> => {
    const url = buildMatrixUrl(
      `/api/matrix/rooms/${encodeURIComponent(roomId)}/read-marker`,
      { homeserver, userId }
    );
    const res = await fetch(url, {
      method: 'PUT',
      headers: buildHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ event_id: eventId }),
    });
    await throwIfNotOk(res, 'Failed to set read marker');
  },

  getRoomMembers: async (homeserver: string, accessToken: string, roomId: string): Promise<MatrixMembersResponse> => {
    const url = buildMatrixUrl(`/api/matrix/rooms/${encodeURIComponent(roomId)}/members`, { homeserver });
    const res = await fetch(url, { headers: buildHeaders(accessToken) });
    await throwIfNotOk(res, 'Failed to get members');
    return res.json();
  },

  getRoomState: async (homeserver: string, accessToken: string, roomId: string): Promise<MatrixRoomStateEvent[]> => {
    const url = buildMatrixUrl(`/api/matrix/rooms/${encodeURIComponent(roomId)}/state`, { homeserver });
    const res = await fetch(url, { headers: buildHeaders(accessToken) });
    await throwIfNotOk(res, 'Failed to get room state');
    return res.json();
  },

  sendTyping: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    userId: string,
    typing: boolean,
    timeout = 30000
  ): Promise<void> => {
    const url = buildMatrixUrl(
      `/api/matrix/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`,
      { homeserver }
    );
    const res = await fetch(url, {
      method: 'PUT',
      headers: buildHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ typing, timeout }),
    });
    // Typing notifications are fire-and-forget, don't throw on error
    if (!res.ok) {
      console.warn('Failed to send typing notification:', res.status);
    }
  },

  uploadMedia: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    file: File
  ): Promise<{ content_uri: string }> => {
    const url = buildMatrixUrl(`/api/matrix/rooms/${encodeURIComponent(roomId)}/upload`, { homeserver });
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData,
    });
    await throwIfNotOk(res, 'Failed to upload media');
    return res.json();
  },

  sendMessage: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    body: string,
    options: { msgtype?: string; format?: string; formattedBody?: string; url?: string; info?: Record<string, unknown>; mentions?: { user_ids: string[] }; relatesTo?: { rel_type?: string; event_id?: string; 'm.in_reply_to'?: { event_id: string } }; newContent?: Record<string, unknown> } = {}
  ): Promise<{ event_id: string }> => {
    const url = buildMatrixUrl(`/api/matrix/rooms/${encodeURIComponent(roomId)}/send`, { homeserver });
    const messageBody: Record<string, unknown> = {
      msgtype: options.msgtype || 'm.text',
      body,
    };
    if (options.format) messageBody.format = options.format;
    if (options.formattedBody) messageBody.formatted_body = options.formattedBody;
    if (options.url) messageBody.url = options.url;
    if (options.info) messageBody.info = options.info;
    if (options.mentions) messageBody['m.mentions'] = options.mentions;
    // Thread replies carry an m.thread relation pointing at the root event.
    if (options.relatesTo) messageBody['m.relates_to'] = options.relatesTo;
    // Edits carry the replacement content under m.new_content.
    if (options.newContent) messageBody['m.new_content'] = options.newContent;
    const res = await fetch(url, {
      method: 'PUT',
      headers: buildHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(messageBody),
    });
    await throwIfNotOk(res, 'Failed to send message');
    return res.json();
  },

  /**
   * Edit an existing message by sending an m.replace relation. The body sent
   * to the homeserver is the spec-mandated "* <new body>" fallback while the
   * real content lives in m.new_content.
   */
  editMessage: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    eventId: string,
    body: string,
    options: { msgtype?: string; format?: string; formattedBody?: string; mentions?: { user_ids: string[] } } = {}
  ): Promise<{ event_id: string }> => {
    const { msgtype = 'm.text', format = 'org.matrix.custom.html', formattedBody, mentions } = options;
    const newContent: Record<string, unknown> = { msgtype, body };
    if (formattedBody) {
      newContent.format = format;
      newContent.formatted_body = formattedBody;
    }
    return matrixApi.sendMessage(homeserver, accessToken, roomId, `* ${body}`, {
      msgtype,
      format: formattedBody ? format : undefined,
      formattedBody,
      mentions,
      relatesTo: { rel_type: 'm.replace', event_id: eventId },
      newContent,
    });
  },

  /** Redact (delete) a message via m.room.redaction. */
  redactMessage: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    eventId: string,
    reason?: string
  ): Promise<{ event_id: string }> => {
    const url = buildMatrixUrl(
      `/api/matrix/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}`,
      { homeserver }
    );
    const res = await fetch(url, {
      method: 'PUT',
      headers: buildHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(reason ? { reason } : {}),
    });
    await throwIfNotOk(res, 'Failed to delete message');
    return res.json();
  },
};
