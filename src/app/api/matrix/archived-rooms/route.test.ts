import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
beforeEach(() => vi.stubEnv('DASHBOARD_STATELESS', '1'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const request = (extra = '', token = 'own-token') => new NextRequest(`http://dashboard/api/matrix/archived-rooms?controllerUrl=http://127.0.0.1:8080&${extra}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
describe('Controller archive proxy', () => {
  it('forwards account filters and caller identity only to Controller', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ rooms: [] }));
    const response = await GET(request('homeserver=https://untrusted.example&team_admin=%40admin%3Atest&human_member=%40human%3Atest&team=design&user_id=ignored'));
    const [url, options] = fetcher.mock.calls[0];
    const target = new URL(String(url));
    expect(target.origin).toBe('http://127.0.0.1:8080');
    expect(target.pathname).toBe('/api/v1/task-rooms/archived');
    expect(Object.fromEntries(target.searchParams)).toEqual({ team_admin: '@admin:test', human_member: '@human:test', team: 'design' });
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer own-token');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([401, 403, 404])('preserves upstream %s', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'denied' }, { status }));
    expect((await GET(request())).status).toBe(status);
  });
  it('does not substitute an administrator token for a missing browser identity', async () => {
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'must-not-forward');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'unauthorized' }, { status: 401 }));
    expect((await GET(request('access_token=query-token', ''))).status).toBe(401);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('authorization')).toBe(false);
  });
});
