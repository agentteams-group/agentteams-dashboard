import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('Matrix room receipt route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards an m.read receipt to the homeserver with the room and event ids', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const request = new NextRequest(
      'http://dashboard.test/api/matrix/rooms/room/receipt?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ eventId: '$event:example.com' }),
      }
    );

    const response = await POST(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [url, options] = matrixFetch.mock.calls[0];
    expect(url).toBe(
      'http://127.0.0.1:6167/_matrix/client/v3/rooms/!room%3Atest/receipt/m.read/%24event%3Aexample.com'
    );
    expect(options?.method).toBe('POST');
    // The m.read endpoint takes an empty body; the event id is in the URL.
    expect(options?.body).toBeUndefined();
  });

  it('rejects requests without an event id', async () => {
    const request = new NextRequest(
      'http://dashboard.test/api/matrix/rooms/room/receipt?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    const response = await POST(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('eventId');
  });
});
