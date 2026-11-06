import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { conditionalFetch, clearConditionalResponses } from './conditional-fetch';
import { useAgentTeamsStore } from './agentteams-store';
import { useMatrixStore } from './matrix-store';
import { updateClientConfig } from './client-config-store';

const url = '/api/agentteams/workers/?fields=spec';
const body = () => new Response('{"workers":[{"name":"a"}]}', { headers: { 'Content-Type': 'application/json', ETag: 'W/"a"' } });

describe('private conditional response cache', () => {
  beforeEach(() => {
    clearConditionalResponses(); localStorage.clear();
    useAgentTeamsStore.setState({ sessionUser: 'a', userLevel: 3, controllerUrl: '' });
    useMatrixStore.setState({ accessToken: '', userId: '', homeserver: '', syncGeneration: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['user', 'role', 'token', 'controller', 'logout'])('never sends a previous validator after %s changes', async (change) => {
    const fetch = vi.fn(async () => body());vi.stubGlobal('fetch', fetch);
    await conditionalFetch(url);
    if (change === 'user') useAgentTeamsStore.setState({ sessionUser: 'b' });
    if (change === 'role') useAgentTeamsStore.setState({ userLevel: 1 });
    if (change === 'token') useMatrixStore.setState({ accessToken: 'new-test-token' });
    if (change === 'controller') updateClientConfig({ controller_urls: ['http://other:8090'] });
    if (change === 'logout') useMatrixStore.getState().logout();
    await conditionalFetch(url);
    expect(new Headers((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers).has('If-None-Match')).toBe(false);
  });

  it('does not expose an in-flight response after an account switch', async () => {
    let finish!: (_r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = conditionalFetch(url);
    useAgentTeamsStore.setState({ sessionUser: 'b' });finish(body());
    await expect(pending).rejects.toMatchObject({ status: 409 });
  });

  it('invalidates both before and after a write, including overlapping reads', async () => {
    let finishWrite!: (_r: Response) => void;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Promise<Response>((resolve) => { finishWrite = resolve; });
      return body();
    });vi.stubGlobal('fetch', fetch);
    await conditionalFetch(url);
    const write = conditionalFetch('/api/agentteams/workers/a/', { method: 'PUT' });
    await conditionalFetch(url);finishWrite(new Response(null, { status: 204 }));await write;
    await conditionalFetch(url);
    for (const index of [2, 3]) expect(new Headers(fetch.mock.calls[index][1]?.headers).has('If-None-Match')).toBe(false);
  });

  it('retries an unsolicited 304 once without a validator', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 304 })).mockResolvedValueOnce(body());vi.stubGlobal('fetch', fetch);
    expect(await (await conditionalFetch(url)).json()).toEqual({ workers: [{ name: 'a' }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not use a cached body after a permission failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(body()).mockResolvedValueOnce(new Response('{}', { status: 403 })).mockResolvedValueOnce(body());vi.stubGlobal('fetch', fetch);
    await conditionalFetch(url);expect((await conditionalFetch(url)).status).toBe(403);await conditionalFetch(url);
    expect(new Headers(fetch.mock.calls[2][1].headers).has('If-None-Match')).toBe(false);
  });

  it('never caches or validates live status, even if an old proxy adds an ETag', async () => {
    const fetch = vi.fn(async () => body());vi.stubGlobal('fetch', fetch);
    await conditionalFetch('/api/agentteams/workers/?fields=status');await conditionalFetch('/api/agentteams/workers/?fields=status');
    expect(new Headers((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers).has('If-None-Match')).toBe(false);
  });

  it.each(['/api/agentteams/version/', '/api/agentteams/skills/?page=1', '/api/agentteams/mcps/'])('revalidates stable metadata at %s', async (path) => {
    const fetch = vi.fn().mockResolvedValueOnce(body()).mockResolvedValueOnce(new Response(null, { status: 304 }));vi.stubGlobal('fetch', fetch);
    await conditionalFetch(path);
    expect(await (await conditionalFetch(path)).json()).toEqual({ workers: [{ name: 'a' }] });
    expect(new Headers(fetch.mock.calls[1][1].headers).get('If-None-Match')).toBe('W/"a"');
  });
});
