import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matrixProxyFetch, matrixProxyUrl } from './matrix-write';
import { useMatrixStore } from './matrix-store';

describe('matrixProxyUrl', () => {
  it('appends homeserver as an encoded query parameter', () => {
    expect(matrixProxyUrl('/api/matrix/rooms/!r:hs/state', 'http://hs:8008')).toBe(
      '/api/matrix/rooms/!r:hs/state/?homeserver=http%3A%2F%2Fhs%3A8008'
    );
  });
});

describe('matrixProxyFetch', () => {
  beforeEach(() => {
    useMatrixStore.setState({
      homeserver: 'http://hs:8008',
      accessToken: 'syt_token',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useMatrixStore.setState({ homeserver: '', accessToken: '' });
  });

  it('sends the homeserver query param and bearer token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await matrixProxyFetch('/api/matrix/rooms/!r:hs/state-event', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'com.agentteams.release' }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('?homeserver=http%3A%2F%2Fhs%3A8008');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer syt_token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('preserves caller headers while injecting the token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await matrixProxyFetch('/api/matrix/rooms/!r:hs/send', {
      method: 'PUT',
      headers: { 'X-Custom': 'yes' },
      body: '{}',
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get('X-Custom')).toBe('yes');
    expect(headers.get('Authorization')).toBe('Bearer syt_token');
  });

  it('throws an actionable error when credentials are missing', async () => {
    useMatrixStore.setState({ homeserver: '', accessToken: '' });
    await expect(matrixProxyFetch('/api/matrix/rooms/!r:hs/state')).rejects.toThrow(
      /homeserver/i
    );
  });
});
