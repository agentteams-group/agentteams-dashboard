import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as archive } from './route';
import { POST as unarchive } from '../unarchive/route';
import { POST as remove } from '../delete/route';

afterEach(() => vi.restoreAllMocks());
describe('task room lifecycle proxies', () => {
  it.each([['archive', archive], ['unarchive', unarchive], ['delete', remove]] as const)('%s preserves caller credentials and upstream denials', async (action, handler) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ errcode: 'M_FORBIDDEN', error: 'denied' }, { status: 403 }));
    const request = new NextRequest(`http://dashboard/api/matrix/rooms/!task:test/${action}?homeserver=http://127.0.0.1:6167`, { method: 'POST', headers: { Authorization: 'Bearer own-token' } });
    const response = await handler(request, { params: Promise.resolve({ roomId: '!task:test' }) });
    expect(fetcher).toHaveBeenCalledWith(`http://127.0.0.1:6167/_matrix/client/unstable/org.agentteams/rooms/!task%3Atest/${action}`, expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer own-token' }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errcode: 'M_FORBIDDEN' });
  });
});
