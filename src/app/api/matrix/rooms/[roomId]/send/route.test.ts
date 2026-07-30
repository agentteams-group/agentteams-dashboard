import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PUT } from './route';

describe('Matrix room message send route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards Matrix formatted_body used by visible mentions', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ event_id: '$event' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const userId = '@smoke-openclaw:matrix-local.agentteams.io:18080';
    const formattedBody = `<a href="https://matrix.to/#/${encodeURIComponent(userId)}">@smoke-openclaw</a> hello`;
    const request = new NextRequest(
      'http://dashboard.test/api/matrix/rooms/room/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: '@smoke-openclaw hello',
          format: 'org.matrix.custom.html',
          formatted_body: formattedBody,
          'm.mentions': { user_ids: [userId] },
        }),
      }
    );

    const response = await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const options = matrixFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string)).toEqual({
      msgtype: 'm.text',
      body: '@smoke-openclaw hello',
      format: 'org.matrix.custom.html',
      formatted_body: formattedBody,
      'm.mentions': { user_ids: [userId] },
    });
  });
});
