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
    body?: string;
    format?: string;
    formatted_body?: string;
    membership?: string;
    displayname?: string;
    avatar_url?: string;
    name?: string;
    topic?: string;
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
}

export interface MatrixMessagesResponse {
  chunk: MatrixEvent[];
  start: string;
  end: string;
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
  const data = await res.json().catch(() => ({ error: fallback }));
  throw new Error(data.error || `${fallback}: ${res.status}`);
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

  sendMessage: async (
    homeserver: string,
    accessToken: string,
    roomId: string,
    body: string,
    options: { msgtype?: string; format?: string; formattedBody?: string } = {}
  ): Promise<{ event_id: string }> => {
    const url = buildMatrixUrl(`/api/matrix/rooms/${encodeURIComponent(roomId)}/send`, { homeserver });
    const res = await fetch(url, {
      method: 'PUT',
      headers: buildHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        msgtype: options.msgtype || 'm.text',
        body,
        format: options.format,
        formattedBody: options.formattedBody,
      }),
    });
    await throwIfNotOk(res, 'Failed to send message');
    return res.json();
  },
};
