import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { proxyToMatrix } = vi.hoisted(() => ({
  proxyToMatrix: vi.fn(async (_request: NextRequest, _homeserver: string, _path: string, _token: string,
    _options: { method: string; forwardBody: boolean }) => Response.json({})),
}));
vi.mock('../../../proxy-helper', () => ({
  getMatrixHomeserver: () => 'http://matrix.test',
  getAccessToken: () => 'matrix-token',
  proxyToMatrix,
}));

import { GET, PUT } from './route';

const params = { params: Promise.resolve({ roomId: '!room:matrix.test' }) };
const url = 'http://localhost/api/matrix/rooms/room/read-marker?userId=%40alice%3Amatrix.test';

describe('room read marker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the existing room account data', async () => {
    await GET(new NextRequest(url), params);
    expect(proxyToMatrix.mock.calls[0][2]).toBe('/_matrix/client/v3/user/%40alice%3Amatrix.test/rooms/!room%3Amatrix.test/account_data/m.fully_read');
  });

  it('writes through the Matrix read_markers endpoint with m.fully_read', async () => {
    const request = new NextRequest(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_id: '$event' }) });
    await PUT(request, params);
    const [upstream, homeserver, path, token, options] = proxyToMatrix.mock.calls[0];
    expect(homeserver).toBe('http://matrix.test');
    expect(path).toBe('/_matrix/client/v3/rooms/!room%3Amatrix.test/read_markers');
    expect(token).toBe('matrix-token');
    expect(options).toEqual({ method: 'POST', forwardBody: true });
    expect(await upstream.json()).toEqual({ 'm.fully_read': '$event' });
  });

  it.each([{}, { event_id: '' }, { event_id: 42 }])('rejects invalid event IDs before contacting Matrix', async (body) => {
    const request = new NextRequest(url, { method: 'PUT', body: JSON.stringify(body) });
    expect((await PUT(request, params)).status).toBe(400);
    expect(proxyToMatrix).not.toHaveBeenCalled();
  });
});
