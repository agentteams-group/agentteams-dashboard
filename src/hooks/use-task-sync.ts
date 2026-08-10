'use client';

import { useEffect, useRef } from 'react';
import { useMatrixStore } from '@/lib/matrix-store';
import { useTaskStore, markEventSeen } from '@/lib/task-store';
import { isWorkflowPayload } from '@/lib/a2ui/workflow';
import { matrixApi } from '@/lib/matrix-api';

/**
 * Lightweight Matrix sync loop that only processes workflow events.
 *
 * Uses useMatrixStore (zustand) for credentials so it lives independent of
 * any React context — the dashboard always renders and starts this sync,
 * even when ChatSection is unmounted.
 *
 * Does NOT conflict with ChatRoom's own sync loop because:
 * 1. Each instance gets its own syncToken stream from the Matrix server
 * 2. markEventSeen() deduplicates events that both loops might see
 *
 * On first run, also pulls recent message history from every joined room
 * (Matrix /sync with no `since` only returns a limited timeline window) so
 * historical tasks surface even when their messages predate the live sync.
 *
 * Poll interval: 3s between calls to keep overhead low while still
 * providing real-time task updates.
 */
export function useTaskSync() {
  // Read credentials from the persisted zustand store — no context dependency.
  const homeserver = useMatrixStore((s) => s.homeserver);
  const accessToken = useMatrixStore((s) => s.accessToken);
  const isLoggedIn = useMatrixStore((s) => s.isLoggedIn);

  const busyRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn || !homeserver || !accessToken) return;

    let cancelled = false;
    let syncToken: string | undefined;
    let timeoutId: ReturnType<typeof setTimeout>;

    /** Extract and persist workflow events from a list of timeline events. */
    const ingestEvents = (
      rid: string,
      timelineEvents: Array<{
        event_id: string;
        type: string;
        sender?: string;
        content?: Record<string, unknown>;
        origin_server_ts?: number;
      }>,
    ) => {
      for (const event of timelineEvents) {
        if (event.type !== 'm.room.message') continue;
        const workflow = event.content?.['agentteams.workflow'];
        if (!isWorkflowPayload(workflow)) continue;
        if (markEventSeen(event.event_id)) continue;

        useTaskStore.getState().upsertTask(
          {
            runId: workflow.runId || workflow.run_id || event.event_id,
            title: workflow.title || workflow.name || '未命名任务',
            status: workflow.status || 'unknown',
            roomId: rid,
            senderMatrixUserId: event.sender || '',
            subagents: Array.isArray(workflow.subagents) ? workflow.subagents : [],
            steps: Array.isArray(workflow.steps) ? workflow.steps : [],
            createdAt: event.origin_server_ts,
          },
          event.origin_server_ts ?? undefined,
        );
      }
    };

    /** One-shot historical loader: walk every joined room, page through recent messages. */
    const loadHistorical = async () => {
      if (cancelled) return;
      try {
        const roomsResp = await matrixApi.getJoinedRooms(homeserver, accessToken);
        if (cancelled) return;
        // Limit to 10 most recent rooms to keep startup snappy
        const rooms = roomsResp.joined_rooms.slice(0, 10);
        await Promise.all(
          rooms.map(async (rid) => {
            if (cancelled) return;
            try {
              const msgs = await matrixApi.getRoomMessages(homeserver, accessToken, rid, { dir: 'b', limit: 30 });
              if (cancelled) return;
              ingestEvents(rid, msgs.chunk as Parameters<typeof ingestEvents>[1]);
            } catch {
              /* room might be read-restricted or have no messages — skip */
            }
          }),
        );
      } catch {
        /* getJoinedRooms may fail if Matrix is unreachable — sync loop will keep trying */
      }
    };

    const poll = async () => {
      if (cancelled || busyRef.current) return;
      busyRef.current = true;
      try {
        const resp = await matrixApi.sync(homeserver, accessToken, syncToken, 15000);
        if (cancelled) return;
        syncToken = resp.next_batch;

        const joinedRooms = resp.rooms?.join;
        if (joinedRooms) {
          for (const [rid, roomData] of Object.entries(joinedRooms)) {
            ingestEvents(rid, (roomData.timeline?.events || []) as Parameters<typeof ingestEvents>[1]);
          }
        }
      } catch {
        /* sync errors are expected on network flaps — retry on next tick */
      } finally {
        busyRef.current = false;
      }

      if (!cancelled) {
        // 3s poll: low overhead while still providing timely task updates
        timeoutId = setTimeout(poll, 3000);
      }
    };

    // Kick off the historical load in parallel with the live sync.
    void loadHistorical();
    // Start with a 1s delay to let ChatRoom's sync grab the initial snapshot first
    timeoutId = setTimeout(poll, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [homeserver, accessToken, isLoggedIn]);
}
