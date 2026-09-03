'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMatrixStore } from '@/lib/matrix-store';
import { useTaskStore, markEventSeen } from '@/lib/task-store';
import { ingestHitlTimelineEvents, useHitlInboxStore } from '@/lib/hitl-inbox';
import { isWorkflowPayload } from '@/lib/a2ui/workflow';
import { matrixApi } from '@/lib/matrix-api';
import type { MatrixEvent } from '@/lib/matrix-api';
import {
  mergeTimelineEvents,
  useReceiptStore,
  useRoomMetaStore,
  useTypingStore,
  type RoomMeta,
} from '@/hooks/use-matrix';

/**
 * Single global Matrix /sync loop, mounted once at dashboard level so it
 * lives for the whole login session regardless of which section is active.
 *
 * Replaces the two independent loops that previously existed:
 * - ChatRoom's useTypingSync (started only when a room was open, restarted on
 *   every room switch because its effect deps included `roomId`)
 * - useTaskSync (a second loop just for workflow events)
 *
 * One loop now serves every consumer: typing indicators, read receipts, room
 * meta (lastMessageTs + unread counts for the sidebar), workflow tasks and —
 * only for the room currently open — real-time timeline merges into the React
 * Query message cache.
 *
 * The sync token lives for the whole session and is never reset by room
 * switches, so after the initial sync the homeserver only sends incremental
 * deltas. A sync filter keeps the initial payload small (no presence, only
 * typing/receipt ephemeral events, lazy-loaded membership).
 */
export function useGlobalMatrixSync(): void {
  const queryClient = useQueryClient();
  const homeserver = useMatrixStore((s) => s.homeserver);
  const accessToken = useMatrixStore((s) => s.accessToken);
  const isLoggedIn = useMatrixStore((s) => s.isLoggedIn);
  const userId = useMatrixStore((s) => s.userId);

  const busyRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn || !homeserver || !accessToken) return;

    const generation = useMatrixStore.getState().syncGeneration;
    const isStale = () => useMatrixStore.getState().syncGeneration !== generation;

    let syncToken: string | undefined;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let retryDelay = 1000;
    let filterRejected = false;

    const SYNC_FILTER = JSON.stringify({
      presence: { types: [] },
      account_data: { types: ['m.fully_read'] },
      room: {
        ephemeral: { types: ['m.typing', 'm.receipt'] },
        timeline: { lazy_load_members: true },
        state: { lazy_load_members: true },
      },
    });

    /** Extract and persist workflow tasks from a list of timeline events. */
    const ingestWorkflowEvents = (
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
        // Deduplicate by event_id so a workflow seen by several sync batches
        // (e.g. the m.replace revisions of the same run) only upserts once.
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

    /** One-shot historical loader: walk joined rooms, page through recent messages. */
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
              ingestWorkflowEvents(rid, msgs.chunk as Parameters<typeof ingestWorkflowEvents>[1]);
              ingestHitlTimelineEvents(rid, msgs.chunk as MatrixEvent[], userId ?? '');
            } catch {
              /* room might be read-restricted or have no messages — skip */
            }
          }),
        );
      } catch {
        /* getJoinedRooms may fail if Matrix is unreachable — sync loop will keep trying */
      }
    };

    /** Process ephemeral typing + read receipt events for one room. */
    const ingestEphemeral = (
      rid: string,
      events: Array<{ type: string; content?: Record<string, unknown> }>,
    ) => {
      for (const event of events) {
        if (event.type === 'm.typing') {
          const typingUserIds = (event.content?.user_ids as string[]) || [];
          const users = typingUserIds.map((uid) => ({
            userId: uid,
            displayName: uid.startsWith('@') ? uid.split(':')[0].slice(1) : uid,
          }));
          useTypingStore.getState().setTypingUsers(rid, users);
        } else if (event.type === 'm.receipt') {
          const content = (event.content ?? {}) as Record<
            string,
            Record<string, Record<string, { ts?: number }> | undefined>
          >;
          const existing = useReceiptStore.getState().receipts[rid] ?? {};
          const next = { ...existing };
          for (const [eventId, relations] of Object.entries(content)) {
            const readBy = relations?.['m.read'];
            if (!readBy) continue;
            for (const [uId, info] of Object.entries(readBy)) {
              next[uId] = {
                eventId,
                ts: typeof info?.ts === 'number' ? info.ts : Date.now(),
              };
            }
          }
          useReceiptStore.getState().setRoomReceipts(rid, next);
        }
      }
    };

    /** Update sidebar meta (last message ts + unread counts) for one room. */
    const ingestRoomMeta = (
      rid: string,
      roomData: { timeline?: { events: Array<{ origin_server_ts?: number }> }; unread_notifications?: { notification_count: number; highlight_count: number } },
    ) => {
      const timelineEvents = roomData.timeline?.events || [];
      const unread = roomData.unread_notifications;
      const lastEventTs = timelineEvents.reduce<number | undefined>(
        (max, e) =>
          typeof e.origin_server_ts === 'number' && e.origin_server_ts > (max ?? 0)
            ? e.origin_server_ts
            : max,
        undefined,
      );
      const metaPartial: Partial<Omit<RoomMeta, 'updatedAt'>> = {};
      if (typeof lastEventTs === 'number') metaPartial.lastMessageTs = lastEventTs;
      if (unread) {
        metaPartial.unreadCount = unread.notification_count;
        metaPartial.unreadHighlightCount = unread.highlight_count;
      }
      if (Object.keys(metaPartial).length > 0) {
        useRoomMetaStore.getState().setRoomMeta(rid, metaPartial);
      }
    };

    const poll = async () => {
      if (cancelled || isStale() || busyRef.current) return;
      busyRef.current = true;
      try {
        const resp = await matrixApi.sync(
          homeserver,
          accessToken,
          syncToken,
          25000,
          filterRejected ? undefined : SYNC_FILTER,
        );
        if (cancelled || isStale()) return;
        syncToken = resp.next_batch;
        retryDelay = 1000;

        const activeRoomId = useRoomMetaStore.getState().activeRoomId;
        const joinedRooms = resp.rooms?.join;
        if (joinedRooms) {
          for (const [rid, roomData] of Object.entries(joinedRooms)) {
            ingestEphemeral(rid, (roomData.ephemeral?.events || []) as Parameters<typeof ingestEphemeral>[1]);
            ingestWorkflowEvents(rid, (roomData.timeline?.events || []) as Parameters<typeof ingestWorkflowEvents>[1]);
            ingestHitlTimelineEvents(
              rid,
              (roomData.timeline?.events || []) as MatrixEvent[],
              userId ?? '',
            );
            ingestRoomMeta(rid, roomData);

            // Only merge timeline events into the message cache for the room
            // that is actually open, so live m.replace streaming updates and
            // new messages never land in a cached room the user is not looking at.
            const timelineEvents = roomData.timeline?.events || [];
            if (timelineEvents.length > 0 && rid === activeRoomId) {
              mergeTimelineEvents(queryClient, rid, timelineEvents, userId);
            }
          }
        }
      } catch (err) {
        // A sync failure is expected on network flaps — back off and retry
        // (max 5s). If the homeserver rejected our custom filter, fall back to
        // an unfiltered sync once and log it.
        if (!filterRejected && (err as { errcode?: string })?.errcode === 'M_UNKNOWN') {
          filterRejected = true;
          console.warn('Matrix sync filter rejected by homeserver; falling back to unfiltered sync');
          retryDelay = 1000;
        } else {
          retryDelay = Math.min(retryDelay * 2, 5000);
        }
      } finally {
        busyRef.current = false;
      }

      if (!cancelled && !isStale()) {
        timeoutId = setTimeout(poll, retryDelay);
      }
    };

    // Kick off the historical load in parallel with the live sync.
    void loadHistorical();
    // Small initial delay so the first sync starts after mount settles.
    timeoutId = setTimeout(poll, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      useHitlInboxStore.getState().clearConfirmations();
    };
  }, [homeserver, accessToken, isLoggedIn, userId, queryClient]);
}
