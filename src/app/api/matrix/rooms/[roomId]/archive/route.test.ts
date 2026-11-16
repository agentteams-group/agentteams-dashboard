import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as archive, GET as status } from './route';
import { POST as unarchive } from '../unarchive/route';
import { POST as remove } from '../delete/route';
beforeEach(() => vi.stubEnv('DASHBOARD_STATELESS', '1'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('Controller task room lifecycle proxies', () => {
  it.each([['archive', archive], ['unarchive', unarchive], ['delete', remove]] as const)('%s preserves caller credentials and Controller denials', async (action, handler) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'denied' }, { status: 403 }));
    const request = new NextRequest(`http://dashboard/api/matrix/rooms/!task:test/${action}?controllerUrl=http://127.0.0.1:8080`, { method: 'POST', headers: { Authorization: 'Bearer own-token' } });
    const response = await handler(request, { params: Promise.resolve({ roomId: '!task:test' }) });
    expect(fetcher).toHaveBeenCalledWith(`http://127.0.0.1:8080/api/v1/task-rooms/!task%3Atest/${action}`, expect.objectContaining({ method: 'POST' }));
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer own-token');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: 'denied' });
  });
  it('reads room eligibility and capabilities from Controller', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ is_task_room: true, archived: false, can_archive: true, can_delete: false }));
    const response = await status(new NextRequest('http://dashboard/api/matrix/rooms/!opaque/archive?controllerUrl=http://127.0.0.1:8080', { headers: { Authorization: 'Bearer own-token' } }), { params: Promise.resolve({ roomId: '!opaque' }) });
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/v1/task-rooms/!opaque/archive');
    expect(await response.json()).toMatchObject({ can_archive: true, can_delete: false });
  });
});
