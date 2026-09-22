import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as joinRoom } from './route';

const HS = 'http%3A%2F%2F127.0.0.1%3A6167';

function makeRequest(roomId: string): NextRequest {
  return new NextRequest(
    `http://dashboard.test/api/matrix/rooms/${encodeURIComponent(roomId)}/join?homeserver=${HS}`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    }
  );
}

describe('Matrix join route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a full room id (!room:hs) and forwards /join', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ room_id: '!room:hs' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const response = await joinRoom(makeRequest('!room:hs'), {
      params: Promise.resolve({ roomId: '!room:hs' }),
    });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [url] = matrixFetch.mock.calls[0];
    // The join endpoint sits at /_matrix/client/v3/join/{roomIdOrAlias},
    // NOT under /rooms/{id} — this is the CS-API v3 quirk that the receipt
    // route above does NOT share. Regression: the proxy used to only
    // accept !room:hs shapes and rejected #alias:hs invites with a 400.
    expect(url).toBe('http://127.0.0.1:6167/_matrix/client/v3/join/!room%3Ahs');
  });

  it('accepts a room alias (#alias:hs) so /sync rooms.invite alias keys round-trip', async () => {
    // Regression for zcode-leak-investigation-20260921-095154:
    // /sync `rooms.invite` keys may be aliases (Matrix CS-API v1.10+).
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ room_id: '!room:hs' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const response = await joinRoom(makeRequest('#alias:hs'), {
      params: Promise.resolve({ roomId: '#alias:hs' }),
    });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [url] = matrixFetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:6167/_matrix/client/v3/join/%23alias%3Ahs');
  });

  it('accepts a room id with a non-default :port suffix on server_name', async () => {
    // Embedded Tuwunel / single-port homeserver setups publish the listen
    // port inside server_name (e.g. matrix-local.agentteams.io:18080), so
    // the proxy must accept those ids verbatim instead of 400-ing the
    // invite accept flow.
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ room_id: '!room:hs:18080' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const roomId = '!72LCaMxEJotzI9n9sk:matrix-local.agentteams.io:18080';
    const response = await joinRoom(makeRequest(roomId), {
      params: Promise.resolve({ roomId }),
    });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [url] = matrixFetch.mock.calls[0];
    expect(url).toBe(
      'http://127.0.0.1:6167/_matrix/client/v3/join/' +
        '!72LCaMxEJotzI9n9sk%3Amatrix-local.agentteams.io%3A18080'
    );
  });

  it('rejects an obviously malformed room id without calling the homeserver', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );

    const response = await joinRoom(makeRequest('not-a-room-id'), {
      params: Promise.resolve({ roomId: 'not-a-room-id' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errcode).toBe('M_INVALID_ROOM_ID');
    expect(matrixFetch).not.toHaveBeenCalled();
  });
});