// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MatrixEvent } from '@/lib/matrix-api';

const mocks = vi.hoisted(() => ({ getRoomRelations: vi.fn() }));
vi.mock('@/lib/matrix-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/matrix-api')>(),
  matrixApi: { getRoomRelations: mocks.getRoomRelations },
}));
vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: () => ({ homeserver: 'https://matrix.test', accessToken: 'token', isLoggedIn: true }),
}));

import { flattenThreadPages, isThreadPaginationUnsupported, useThreadReplies } from './use-thread-replies';
import { MatrixRequestError } from '@/lib/matrix-api';

function event(index: number): MatrixEvent {
  return {
    event_id: `$reply-${index}`,
    sender: '@worker:test',
    type: 'm.room.message',
    origin_server_ts: index,
    content: { msgtype: 'm.text', body: `reply ${index}` },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('thread relation cursor pagination', () => {
  it('loads 51 replies across two pages and forwards the opaque cursor', async () => {
    const first = Array.from({ length: 50 }, (_, index) => event(index));
    mocks.getRoomRelations
      .mockResolvedValueOnce({ chunk: first, next_batch: 'opaque-next' })
      .mockResolvedValueOnce({ chunk: [event(50)] });

    const { result } = renderHook(() => useThreadReplies('!room:test', '$thread'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pages[0].chunk).toHaveLength(50);
    expect(result.current.hasNextPage).toBe(true);
    expect(mocks.getRoomRelations).toHaveBeenNthCalledWith(
      1, 'https://matrix.test', 'token', '!room:test', '$thread', 'm.thread',
      expect.objectContaining({ limit: 50, dir: 'b', signal: expect.any(AbortSignal) }),
    );

    await act(async () => { await result.current.fetchNextPage(); });
    expect(mocks.getRoomRelations).toHaveBeenNthCalledWith(
      2, 'https://matrix.test', 'token', '!room:test', '$thread', 'm.thread',
      expect.objectContaining({ limit: 50, from: 'opaque-next', dir: 'b' }),
    );
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    const replies = flattenThreadPages(result.current.data!.pages);
    expect(replies).toHaveLength(51);
    expect(replies[50].event_id).toBe('$reply-50');
    expect(result.current.hasNextPage).toBe(false);
  });

  it('deduplicates overlapping relation pages', () => {
    expect(flattenThreadPages([
      { chunk: [event(1), event(2)] },
      { chunk: [event(2), event(3)] },
    ]).map((item) => item.event_id)).toEqual(['$reply-1', '$reply-2', '$reply-3']);
  });

  it.each([
    new MatrixRequestError('unsupported', 'M_UNRECOGNIZED', 400),
    new MatrixRequestError('missing', undefined, 404),
    new MatrixRequestError('method', undefined, 405),
  ])('recognizes unsupported pagination errors', (error) => {
    expect(isThreadPaginationUnsupported(error)).toBe(true);
  });

  it('does not classify authentication or transient failures as unsupported pagination', () => {
    expect(isThreadPaginationUnsupported(new MatrixRequestError('forbidden', 'M_FORBIDDEN', 403))).toBe(false);
    expect(isThreadPaginationUnsupported(new Error('network'))).toBe(false);
  });
});
