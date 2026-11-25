import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { agentteamsApi } from './agentteams-api';
import { useAgentTeamsStore } from './agentteams-store';
import { useMatrixStore } from './matrix-store';

const json = (data: unknown, etag?: string) => new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) },
});

describe('projected Worker polling compatibility', () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentTeamsStore.setState({ sessionUser: 'alice', userLevel: 3, controllerUrl: '' });
    useMatrixStore.setState({ accessToken: '', userId: '', homeserver: '', syncGeneration: Date.now() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('joins stable spec and live status by name, reuses 304, and never fetches row details', async () => {
    let round = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('fields=spec')) {
        if (round++) {
          expect(new Headers(init?.headers).get('If-None-Match')).toBe('W/"spec1"');
          return new Response(null, { status: 304 });
        }
        return json({ workers: [{ name: 'a', model: 'm', runtime: 'qwenpaw' }, { name: 'b', model: 'n' }] }, 'W/"spec1"');
      }
      expect(url).toContain('fields=status');
      return json({ workers: [{ name: 'b', phase: 'Sleeping' }, { name: 'a', phase: round > 1 ? 'Failed' : 'Running' }] });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await agentteamsApi.listWorkerSummaries()).toMatchObject([{ name: 'b', model: 'n', phase: 'Sleeping' }, { name: 'a', model: 'm', phase: 'Running' }]);
    expect(await agentteamsApi.listWorkerSummaries()).toMatchObject([{ name: 'b', model: 'n' }, { name: 'a', model: 'm', phase: 'Failed' }]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('falls back to the full collection when an older Controller rejects fields', async () => {
    const fetch = vi.fn(async (url: string) => url.includes('fields=')
      ? new Response('{"message":"unknown fields"}', { status: 400 })
      : json([{ name: 'old', skills: ['preserved'], phase: 'Running' }]));
    vi.stubGlobal('fetch', fetch);
    expect(await agentteamsApi.listWorkerSummaries()).toMatchObject([{ name: 'old', skills: ['preserved'] }]);
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/workers/'))).toBe(true);
  });

  it('does not hide permission or infrastructure errors with a compatibility fallback', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(agentteamsApi.listWorkerSummaries()).rejects.toMatchObject({ status: 403 });
    expect(fetch.mock.calls.every(([url]: unknown[]) => String(url).includes('fields='))).toBe(true);
  });

  it('accepts old Controllers that ignore fields and return full array rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ name: 'old', runtime: 'qwenpaw', skills: ['existing'], phase: 'Running' }])));
    expect(await agentteamsApi.listWorkerSummaries()).toEqual([{ name: 'old', runtime: 'qwenpaw', skills: ['existing'], phase: 'Running' }]);
  });

  it('reconciles add/delete/reorder between the two projections without per-row reads', async () => {
    let specs = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('fields=spec')) return json({ workers: specs++ ? [{ name: 'new', model: 'n' }] : [{ name: 'deleted', model: 'd' }] });
      return json({ workers: [{ name: 'new', phase: 'Running' }] });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await agentteamsApi.listWorkerSummaries()).toEqual([{ name: 'new', model: 'n', phase: 'Running' }]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps listWorkers as the full-detail collection API for export and existing callers', async () => {
    const fetch = vi.fn(async (_url: string) => json([{ name: 'a', env: { X: 'y' }, skills: ['s'] }]));
    vi.stubGlobal('fetch', fetch);
    expect(await agentteamsApi.listWorkers()).toMatchObject([{ skills: ['s'], env: { X: 'y' } }]);
    expect(String(fetch.mock.calls[0][0])).not.toContain('fields=');
  });
});
