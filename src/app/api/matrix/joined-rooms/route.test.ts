import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

afterEach(() => vi.restoreAllMocks());
const request = (query = 'homeserver=http%3A%2F%2F127.0.0.1%3A6167', token?: string) => new NextRequest(`http://dashboard.test/api/matrix/joined-rooms?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('own-session joined rooms proxy', () => {
  it('forwards only the caller bearer token and prevents membership caching', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ joined_rooms: ['!own:test'] }));
    const response = await GET(request(undefined, 'caller-token'));
    expect(upstream).toHaveBeenCalledWith('http://127.0.0.1:6167/_matrix/client/v3/joined_rooms', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer caller-token' }) }));
    expect(await response.json()).toEqual({ joined_rooms: ['!own:test'] });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects missing or query-string credentials without contacting an upstream', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const response = await GET(request('homeserver=http%3A%2F%2F127.0.0.1%3A6167&access_token=query-token'));
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects an unapproved homeserver before forwarding credentials', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const response = await GET(request('homeserver=https%3A%2F%2Funapproved.example', 'caller-token'));
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([401, 403])('preserves upstream %s instead of fabricating an empty membership list', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ errcode: 'M_FORBIDDEN' }, { status }));
    const response = await GET(request(undefined, 'caller-token'));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ errcode: 'M_FORBIDDEN' });
  });
});
