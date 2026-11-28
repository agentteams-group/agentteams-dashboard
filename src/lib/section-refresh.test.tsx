import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  REFRESH_BATCH_SIZE,
  queryMatchesSection,
  refreshSectionQueries,
} from './section-refresh';

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('section refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('matches only the active section and active Matrix room', () => {
    expect(queryMatchesSection(['agentteams-projects'], 'tasks')).toBe(true);
    expect(queryMatchesSection(['agentteams-projects'], 'models')).toBe(false);
    expect(queryMatchesSection(['matrix-messages', '!active:test'], 'chat', '!active:test')).toBe(true);
    expect(queryMatchesSection(['matrix-messages', '!other:test'], 'chat', '!active:test')).toBe(false);
    expect(queryMatchesSection(['matrix-thread', '!active:test', '$root'], 'chat', '!active:test')).toBe(true);
    expect(queryMatchesSection(['matrix-event', 'https://hs', '@me', '!active:test', '$event'], 'chat', '!active:test')).toBe(true);
    expect(queryMatchesSection(['matrix-event', 'https://hs', '@me', '!other:test', '$event'], 'chat', '!active:test')).toBe(false);
    expect(queryMatchesSection(['matrix-messages', '!active:test'], 'chat', null)).toBe(false);
  });

  it('invalidates precise section keys without refetching inactive queries', async () => {
    const client = createClient();
    client.setQueryData(['agentteams-projects'], { projects: [] });
    client.setQueryData(['agentteams-task-index'], { tasks: [] });
    client.setQueryData(['matrix-messages', '!active:test'], { pages: [] });
    client.setQueryData(['matrix-messages', '!other:test'], { pages: [] });
    client.setQueryData(['agentteams-models'], []);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const refresh = refreshSectionQueries(client, 'chat', '!active:test');
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { await vi.runAllTimersAsync(); });
    await refresh;

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(['agentteams-projects'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['agentteams-task-index'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['matrix-messages', '!active:test'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['matrix-messages', '!other:test'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['agentteams-models'])?.isInvalidated).toBe(false);
  });

  it('deduplicates active keys and refetches at most six requests at a time', async () => {
    const client = createClient();
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    const request = vi.fn(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<unknown>((resolve) => {
        resolvers.push(() => {
          active -= 1;
          resolve({ ok: true });
        });
      });
    });
    const { unmount } = renderHook(() => {
      // Fixed hook count: two observers share thread-0, yielding 13 unique keys.
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-0'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-0'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-1'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-2'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-3'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-4'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-5'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-6'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-7'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-8'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-9'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-10'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-11'], queryFn: request });
      useQuery({ queryKey: ['matrix-thread', '!active:test', 'thread-12'], queryFn: request });
    }, { wrapper: wrapperFor(client) });

    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(request).toHaveBeenCalledTimes(13);
    request.mockClear();
    maxActive = 0;

    const refresh = refreshSectionQueries(client, 'chat', '!active:test');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(request).toHaveBeenCalledTimes(REFRESH_BATCH_SIZE);
    expect(maxActive).toBe(REFRESH_BATCH_SIZE);

    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(request).toHaveBeenCalledTimes(12);

    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(request).toHaveBeenCalledTimes(13);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    await refresh;
    expect(request).toHaveBeenCalledTimes(13);
    expect(maxActive).toBeLessThanOrEqual(REFRESH_BATCH_SIZE);
    unmount();
  });

  it('yields to the browser before section cache work', async () => {
    const client = createClient();
    for (let index = 0; index < 100; index += 1) {
      client.setQueryData(['agentteams-project-workflow', 'team', `project-${index}`], { nodes: [] });
    }
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    let settled = false;
    const refresh = refreshSectionQueries(client, 'tasks').then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { await vi.runAllTimersAsync(); });
    await refresh;
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
