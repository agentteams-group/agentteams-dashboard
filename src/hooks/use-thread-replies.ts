import { useInfiniteQuery } from '@tanstack/react-query';
import { matrixApi, MatrixRequestError, type MatrixEvent } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';

export const THREAD_REPLY_PAGE_SIZE = 50;

/** Matrix versions predating the relations endpoint cannot paginate a thread. */
export function isThreadPaginationUnsupported(error: unknown): boolean {
  return error instanceof MatrixRequestError && (
    error.errcode === 'M_UNRECOGNIZED'
    || error.errcode === 'M_UNKNOWN'
    || error.status === 404
    || error.status === 405
  );
}

/**
 * Thread replies use Matrix's relations cursor (`next_batch`). The query key is
 * shared with the existing thread invalidation path, so sending a reply still
 * refreshes every loaded page without coupling this hook to use-matrix.ts.
 */
export function useThreadReplies(roomId: string, threadId: string) {
  const { homeserver, accessToken, isLoggedIn } = useMatrixStore();

  return useInfiniteQuery({
    queryKey: ['matrix-thread', roomId, threadId],
    queryFn: ({ pageParam, signal }: { pageParam: string; signal: AbortSignal }) =>
      matrixApi.getRoomRelations(homeserver, accessToken, roomId, threadId, 'm.thread', {
        limit: THREAD_REPLY_PAGE_SIZE,
        from: pageParam || undefined,
        dir: 'b',
        signal,
      }),
    initialPageParam: '',
    getNextPageParam: (lastPage: MatrixRelationsPage) => lastPage.next_batch || undefined,
    enabled: isLoggedIn && !!roomId && !!threadId && !!homeserver && !!accessToken,
    staleTime: 5000,
    retry: false,
    throwOnError: false,
  });
}

type MatrixRelationsPage = Awaited<ReturnType<typeof matrixApi.getRoomRelations>>;

/** Flatten newest-first relation pages, dropping duplicate events defensively. */
export function flattenThreadPages(pages: MatrixRelationsPage[]): MatrixEvent[] {
  const seen = new Set<string>();
  const events: MatrixEvent[] = [];
  for (const page of pages) {
    for (const event of page.chunk) {
      if (seen.has(event.event_id)) continue;
      seen.add(event.event_id);
      events.push(event);
    }
  }
  return events;
}
