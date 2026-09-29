import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as leaveRoom } from './route';

const HS = 'http%3A%2F%2F127.0.0.1%3A6167';

function makeRequest(roomId: string): NextRequest {
  return new NextRequest(
    `http://dashboard.test/api/matrix/rooms/${encodeURIComponent(roomId)}/leave?homeserver=${HS}`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    }
  );
}

describe('Matrix leave route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a full room id (!room:hs) and forwards /leave', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );

    const response = await leaveRoom(makeRequest('!room:hs'), {
      params: Promise.resolve({ roomId: '!room:hs' }),
    });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [url] = matrixFetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:6167/_matrix/client/v3/rooms/!room%3Ahs/leave');
  });

  it('accepts a room alias (#alias:hs) so an alias-keyed invite can be rejected', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );

    const response = await leaveRoom(makeRequest('#alias:hs'), {
      params: Promise.resolve({ roomId: '#alias:hs' }),
    });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [url] = matrixFetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:6167/_matrix/client/v3/rooms/%23alias%3Ahs/leave');
  });

  it('accepts a room id with a non-default :port suffix on server_name', async () => {
    // Embedded Tuwunel / single-port homeserver setups publish the listen
    // port inside server_name (e.g. matrix-local.agentteams.io:18080), so
    // the proxy must accept those ids verbatim instead of 400-ing the
    // invite reject / leave path.
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );

    const roomId = '!72LCaMxEJotzI9n9sk:matrix-local.agentteams.io:18080';
    const response = await leaveRoom(makeRequest(roomId), {
      params: Promise.resolve({ roomId }),
    });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [url] = matrixFetch.mock.calls[0];
    expect(url).toBe(
      'http://127.0.0.1:6167/_matrix/client/v3/rooms/' +
        '!72LCaMxEJotzI9n9sk%3Amatrix-local.agentteams.io%3A18080/leave'
    );
  });

  it('rejects an obviously malformed room id', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );

    const response = await leaveRoom(makeRequest('../etc/passwd'), {
      params: Promise.resolve({ roomId: '../etc/passwd' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errcode).toBe('M_INVALID_ROOM_ID');
    expect(matrixFetch).not.toHaveBeenCalled();
  });
});