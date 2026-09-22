'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMatrixStore } from '@/lib/matrix-store';
import { useTaskStore, markEventSeen } from '@/lib/task-store';
import { ingestHitlTimelineEvents, useHitlInboxStore } from '@/lib/hitl-inbox';
import { isWorkflowPayload } from '@/lib/a2ui/workflow';
import { matrixApi } from '@/lib/matrix-api';
import type { MatrixEvent } from '@/lib/matrix-api';
import { useInviteStore } from '@/lib/matrix-invite-store';
import {
  mergeTimelineEvents,
  useReceiptStore,
  useRoomMetaStore,
  useTypingStore,
  type RoomMeta,
} from '@/hooks/use-matrix';
import { extractMessagePreview } from '@/components/dashboard/sections/chat/room-builders';
import {
  bufferSyncEvents,
  recordSyncFailure,
  recordSyncSuccess,
} from '@/lib/matrix-sync-buffer';

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

  useEffect(() => {
    if (!isLoggedIn || !homeserver || !accessToken) return;

    const generation = useMatrixStore.getState().syncGeneration;
    const isStale = () => useMatrixStore.getState().syncGeneration !== generation;

    // FUNC-01: the in-flight flag is per-effect (closure), NOT a hook-level
    // ref. A component ref survives effect re-creation (StrictMode double
    // mount, error-boundary remount), so the new loop's first poll used to
    // hit busyRef=true left by the previous long-poll and bail out without
    // rescheduling — the whole sync chain went dark until a manual refresh.
    let busy = false;
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
        // 12.13：房间名采集——对全部已加入房间（上限 80）取 m.room.name，
        // 填 meta.roomName（项目群等未归类房间在侧栏出现的前提；一次/会话）。
        const nameRooms = roomsResp.joined_rooms.slice(0, 80);
        await Promise.all(
          nameRooms.map(async (rid) => {
            if (cancelled) return;
            try {
              const state = await matrixApi.getRoomState(homeserver, accessToken, rid);
              const nameEv = state.find((e) => e.type === 'm.room.name');
              const content = (nameEv?.content ?? {}) as { name?: unknown };
              const nm = typeof content.name === 'string' ? content.name.trim() : '';
              const joined = state.filter(
                (e) =>
                  e.type === 'm.room.member' &&
                  (e.content as { membership?: unknown })?.membership === 'join',
              ).length;
              const patch: { roomName?: string; memberCount?: number } = {};
              if (nm) patch.roomName = nm;
              if (joined > 0) patch.memberCount = joined;
              if (Object.keys(patch).length > 0) {
                useRoomMetaStore.getState().setRoomMeta(rid, patch);
              }
            } catch {
              /* state may be restricted — skip */
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

    /** True when the event is a thread reply (m.thread relation). */
    const isThreadReply = (e: { content?: Record<string, unknown> }): boolean =>
      (e.content?.['m.relates_to'] as { rel_type?: string } | undefined)?.rel_type ===
      'm.thread';

    /** Update sidebar meta (last message ts/preview + unread counts) for one room. */
    const ingestRoomMeta = (
      rid: string,
      roomData: {
        timeline?: { events: Array<{ origin_server_ts?: number; type?: string; content?: { body?: unknown; msgtype?: string } }> };
        state?: { events?: Array<{ type?: string; content?: Record<string, unknown> }> };
        summary?: Record<string, unknown>;
        unread_notifications?: { notification_count: number; highlight_count: number };
      },
    ) => {
      const timelineEvents = roomData.timeline?.events || [];
      const unread = roomData.unread_notifications;
      let lastEvent: (typeof timelineEvents)[number] | undefined;
      for (const event of timelineEvents) {
        if (typeof event.origin_server_ts !== 'number') continue;
        if (!lastEvent || event.origin_server_ts >= (lastEvent.origin_server_ts ?? 0)) {
          lastEvent = event;
        }
      }
      const metaPartial: Partial<Omit<RoomMeta, 'updatedAt'>> = {};
      if (typeof lastEvent?.origin_server_ts === 'number') {
        metaPartial.lastMessageTs = lastEvent.origin_server_ts;
        const preview = extractMessagePreview(lastEvent);
        if (preview) metaPartial.lastMessagePreview = preview;
      }
      if (unread) {
        metaPartial.unreadCount = unread.notification_count;
        metaPartial.unreadHighlightCount = unread.highlight_count;
      }
      // 12.15：成员数（sync summary）——群组/私聊分类用；缺省时由
      // loadHistorical 的 state 计数补齐。
      const summaryCount = Number(roomData.summary?.['m.joined_member_count']);
      if (Number.isFinite(summaryCount) && summaryCount > 0) {
        metaPartial.memberCount = summaryCount;
      }
      // 12.13：房间名采集（/sync state 段）——未归类房间（项目群等）
      // 侧栏可见性的前提；增量 sync 只在改名时携带，老房间由
      // loadHistorical 的 state 一次性补齐。
      for (const se of roomData.state?.events || []) {
        if (se.type === 'm.room.name' && typeof se.content?.name === 'string') {
          const nm = se.content.name.trim();
          if (nm) {
            metaPartial.roomName = nm;
            break;
          }
        }
      }
      if (Object.keys(metaPartial).length > 0) {
        useRoomMetaStore.getState().setRoomMeta(rid, metaPartial);
      }
    };

    /** F-4 / 需求 4.1-4.3: ingest `rooms.invite` from a /sync response.
     *  The Matrix spec guarantees invite keys are `!room:hs` room IDs (not
     *  aliases) but our join proxy still accepts both, so we pass through
     *  whatever the homeserver sent. Sender + best-effort room name come
     *  from `invite_state.events`; we look for the canonical m.room.member
     *  (membership=invite) and the optional m.room.name state event. */
    const ingestInvites = (invited: Record<string, { invite_state?: { events?: MatrixEvent[] } }> | undefined) => {
      if (!invited) return;
      for (const [roomId, snap] of Object.entries(invited)) {
        let sender = '';
        let roomName: string | undefined;
        let originTs: number | undefined;
        for (const ev of snap.invite_state?.events ?? []) {
          if (ev.sender && !sender) sender = ev.sender;
          if (ev.type === 'm.room.name' && typeof ev.content?.name === 'string') {
            const nm = ev.content.name.trim();
            if (nm) roomName = nm;
          }
          if (typeof ev.origin_server_ts === 'number') {
            originTs = Math.max(originTs ?? 0, ev.origin_server_ts);
          }
        }
        if (!sender) continue; // malformed invite — skip
        useInviteStore.getState().upsertInvite({ roomId, sender, roomName, originTs });
      }
    };

    const poll = async () => {
      // Stale/cancelled: this effect instance is dead — never reschedule.
      if (cancelled || isStale()) return;
      // Busy: a previous long-poll is still in flight (its finally will clear
      // the flag) — reschedule so the loop keeps breathing instead of dying.
      if (busy) {
        timeoutId = setTimeout(poll, retryDelay);
        return;
      }
      busy = true;
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

        let maxEventTs = 0;
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

            // F-4: the invite snapshot is keyed by roomId and a single
            // roomId can't be in both `invite` and `join` simultaneously
            // (Client-Server spec); the homeserver drops an invite once we
            // accept it, but we drop our cached entry eagerly here so the
            // inbox count goes down the moment the operator clicks accept.
            useInviteStore.getState().dropByRoomId(rid);

            // Element-style realtime: merge timeline events into the message
            // cache of EVERY room that has one (open or recently visited),
            // not only the active room. Events for rooms without a cache are
            // buffered and replayed by the message queryFn when the room is
            // opened — dedupe by event_id makes both paths idempotent, so
            // nothing is dropped and nothing double-renders.
            const timelineEvents = (roomData.timeline?.events || []) as MatrixEvent[];
            if (timelineEvents.length > 0) {
              for (const ev of timelineEvents) {
                if (typeof ev.origin_server_ts === 'number' && ev.origin_server_ts > maxEventTs) {
                  maxEventTs = ev.origin_server_ts;
                }
              }
              if (queryClient.getQueryData(['matrix-messages', rid])) {
                mergeTimelineEvents(queryClient, rid, timelineEvents, userId ?? '');
              } else {
                bufferSyncEvents(rid, timelineEvents);
              }
              // Thread replies paginate in their own view — invalidate the
              // room's thread queries (only active ones refetch).
              if (timelineEvents.some(isThreadReply)) {
                queryClient.invalidateQueries({ queryKey: ['matrix-thread', rid] });
              }
            }
          }
        }
        recordSyncSuccess(maxEventTs);

        // F-4 / 需求 4.1: ingest new invites after the join loop so the
        // roomId set in `rooms.invite` is always the most recent snapshot.
        ingestInvites(resp.rooms?.invite);

        // F-4 / 需求 4.3: a `rooms.leave` entry for a room we never joined
        // (the operator explicitly rejected or the inviter revoked the
        // invitation) clears our cached invite entry. Joined rooms that the
        // operator leaves are handled by `forgetRoom` elsewhere — we don't
        // re-drop invites for those here.
        const leftKeys = Object.keys(resp.rooms?.leave ?? {});
        if (leftKeys.length > 0) {
          const inviteState = useInviteStore.getState();
          for (const rid of leftKeys) {
            // The cache hit is gated on the room not being a join we just
            // received in this same response — already covered above.
            inviteState.dropByRoomId(rid);
          }
        }
      } catch (err) {
        // A sync failure is expected on network flaps — back off and retry
        // (max 5s). If the homeserver rejected our custom filter, fall back to
        // an unfiltered sync once and log it.
        recordSyncFailure(err instanceof Error ? err.message : String(err));
        if (!filterRejected && (err as { errcode?: string })?.errcode === 'M_UNKNOWN') {
          filterRejected = true;
          console.warn('Matrix sync filter rejected by homeserver; falling back to unfiltered sync');
          retryDelay = 1000;
        } else {
          retryDelay = Math.min(retryDelay * 2, 5000);
        }
      } finally {
        busy = false;
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
