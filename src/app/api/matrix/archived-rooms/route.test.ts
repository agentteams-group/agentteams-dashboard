import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

afterEach(() => vi.restoreAllMocks());
describe('archived rooms proxy', () => {
  it('forwards account filters with the current caller token and no shared cache', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ rooms: [] }));
    const response = await GET(new NextRequest('http://dashboard/api/matrix/archived-rooms?homeserver=http://127.0.0.1:6167&team_admin=%40admin%3Atest&human_member=%40human%3Atest&team=design&user_id=ignored', { headers: { Authorization: 'Bearer own-token' } }));
    const [url, options] = fetcher.mock.calls[0];
    const target = new URL(String(url));
    expect(target.pathname).toBe('/_matrix/client/unstable/org.agentteams/rooms/archived');
    expect(Object.fromEntries(target.searchParams)).toEqual({ team_admin: '@admin:test', human_member: '@human:test', team: 'design' });
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer own-token' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([401, 403, 404])('preserves upstream %s', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'upstream' }, { status }));
    const response = await GET(new NextRequest('http://dashboard/api/matrix/archived-rooms?homeserver=http://127.0.0.1:6167', { headers: { Authorization: 'Bearer own-token' } }));
    expect(response.status).toBe(status);
  });
  it('rejects missing tokens and unapproved homeservers', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const query of ['homeserver=http://127.0.0.1:6167&access_token=query-token', 'homeserver=https://unapproved.example']) {
      expect((await GET(new NextRequest(`http://dashboard/api/matrix/archived-rooms?${query}`))).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
