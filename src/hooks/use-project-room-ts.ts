import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useMatrixStore } from '@/lib/matrix-store';
import { fetchProjectRoomTs } from '@/lib/project-room-ts';
import type { BoardProject } from '@/hooks/use-task-board';

/**
 * Room-activity timestamps for board projects that have none of their own
 * (controller projectSummary carries no created_at/updated_at yet, and
 * generated project ids embed no date). Fetches the last Matrix event ts of
 * each project room (limit 1, backward), cached 60 s.
 *
 * `enabled=false` (e.g. when the sort is by name) returns an empty map and
 * issues zero requests. Only projects with `createdAt === 0` and a room are
 * queried; projects with real timestamps never pay a request.
 */
export function useProjectRoomTimestamps(
  projects: BoardProject[],
  enabled: boolean,
): Map<string, number> {
  const homeserver = useMatrixStore((s) => s.homeserver);
  const accessToken = useMatrixStore((s) => s.accessToken);
  const isLoggedIn = useMatrixStore((s) => s.isLoggedIn);

  const needTs = useMemo(
    () => (enabled ? projects.filter((p) => !p.createdAt && p.roomId) : []),
    [projects, enabled],
  );

  const results = useQueries({
    queries: needTs.map((p) => ({
      queryKey: ['project-room-ts', p.roomId],
      queryFn: () => fetchProjectRoomTs(homeserver, accessToken, p.roomId),
      enabled: isLoggedIn && !!homeserver && !!accessToken,
      staleTime: 60_000,
      retry: 0,
    })),
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    needTs.forEach((p, i) => {
      const v = results[i]?.data;
      if (v) m.set(p.runId, v);
    });
    return m;
  }, [needTs, results]);
}
