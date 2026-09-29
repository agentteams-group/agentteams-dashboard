'use client';

import { useSyncExternalStore } from 'react';

import { useRoomMetaStore, useTypingStore } from '@/hooks/use-matrix';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import {
  TICK_MS,
  workerSessionState,
  roomWorkerState,
} from '@/lib/worker-session-state';
import type { WorkerSessionState, WorkerAgentStatusInfo } from '@/lib/worker-session-state';

/**
 * matrixUserID → runtime task-level status, from the polled worker list
 * (15s). Older controllers (no worker-agent-status fields) yield entries
 * with all fields undefined — the derivation then falls back to typing +
 * message age. Consumed by the per-sender message-bubble dots in ChatRoom.
 */
export function useWorkerAgentStatusMap(): Record<string, WorkerAgentStatusInfo & { phase?: string }> {
  const { data: workers } = useWorkers();
  const map: Record<string, WorkerAgentStatusInfo & { phase?: string }> = {};
  for (const w of workers ?? []) {
    if (!w.matrixUserID) continue;
    map[w.matrixUserID] = {
      agentStatus: w.agentStatus,
      runningTaskCount: w.runningTaskCount,
      lastFinishAt: w.lastFinishAt,
      lastRunAt: w.lastRunAt,
      phase: w.phase,
    };
  }
  return map;
}

/**
 * Shared 60s clock driving the done→idle aging of the session dots.
 * (Re-derivation only — no network; see worker-session-state.ts.)
 *
 * Module-level single interval with subscriber counting (FUNC-09): the
 * timer runs only while at least one consumer is mounted, and every
 * consumer re-derives from the same tick instead of N separate
 * intervals firing N re-renders.
 */
const tickListeners = new Set<() => void>();
let sharedTickNow = Date.now();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeTick(onStoreChange: () => void): () => void {
  tickListeners.add(onStoreChange);
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      sharedTickNow = Date.now();
      for (const listener of tickListeners) listener();
    }, TICK_MS);
  }
  return () => {
    tickListeners.delete(onStoreChange);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

export function useSessionTick(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => sharedTickNow,
    () => sharedTickNow,
  );
}

/**
 * Three-state session dot for a worker (worker list rows, 1:1 room
 * cards). The worker's 1:1 room is the only room where done/idle is
 * meaningful (a DM room is structurally just the worker + the human).
 *
 * Store selectors return primitives only — stable subscriptions, no
 * useSyncExternalStore churn.
 */
export function useWorkerSessionState(
  worker: { matrixUserID?: string; roomID?: string; phase?: string },
  nowArg?: number,
): WorkerSessionState {
  const tick = useSessionTick();
  const now = nowArg ?? tick;
  // (hooks below are unconditional — the worker identity may change
  // between renders while the list row stays mounted)
  const isTyping = useTypingStore((s) => {
    const room = worker.roomID ? s.typingUsers[worker.roomID] : undefined;
    if (!room || !worker.matrixUserID) return false;
    return room.some((u) => u.userId === worker.matrixUserID);
  });
  const lastMessageTs = useRoomMetaStore((s) =>
    worker.roomID ? s.meta[worker.roomID]?.lastMessageTs : undefined,
  );
  return workerSessionState(worker.matrixUserID, [
    {
      typing: isTyping && worker.matrixUserID ? [worker.matrixUserID] : [],
      lastMessageTs,
      memberIds: worker.matrixUserID ? [worker.matrixUserID] : [],
    },
  ], now, worker.phase);
}

const EMPTY_TYPING: ReadonlyArray<{ userId: string; displayName: string }> = [];

/**
 * Session state for a single-worker (1:1) room from its room id —
 * used where the worker object is not at hand (sidebar worker rooms,
 * the 1:1 chat header).
 */
export function useRoomSessionState(
  roomId: string | undefined,
  workerMxid: string | undefined,
  nowArg?: number,
): WorkerSessionState {
  const tick = useSessionTick();
  const now = nowArg ?? tick;
  // Unconditional subscriptions (rules of hooks); the empty constant
  // keeps the snapshot reference stable when the room has no typing.
  const typing = useTypingStore((s) => (roomId ? s.typingUsers[roomId] ?? EMPTY_TYPING : EMPTY_TYPING));
  const lastMessageTs = useRoomMetaStore((s) => (roomId ? s.meta[roomId]?.lastMessageTs : undefined));
  if (!roomId || !workerMxid) return 'idle';
  return roomWorkerState(
    { typing: typing.map((u) => u.userId), lastMessageTs },
    new Set([workerMxid]),
    now,
  );
}

/**
 * Team rooms: running only (any of the room's workers typing). Never
 * done/idle — v1.51 decision (no per-user last-sender data for team
 * rooms; human messages must not trigger green).
 */
export function useRoomRunningState(
  roomId: string | undefined,
  workerMatrixUserIds: string[] | undefined,
): boolean {
  return useTypingStore((s) => {
    if (!roomId || !workerMatrixUserIds || workerMatrixUserIds.length === 0) return false;
    const room = s.typingUsers[roomId];
    if (!room) return false;
    const set = new Set(workerMatrixUserIds);
    return room.some((u) => set.has(u.userId));
  });
}

/**
 * Chat header: three-state for a 1:1 room (exactly one worker MXID),
 * running-only for a team room (multiple workers). Both subscriptions
 * are unconditional (rules of hooks) — the unneeded one simply idles.
 */
export function useChatRoomSessionState(
  roomId: string | undefined,
  workerMatrixUserIds: string[] | undefined,
): { state: WorkerSessionState; runningOnly: boolean } {
  const now = useSessionTick();
  const runningOnly = (workerMatrixUserIds?.length ?? 0) > 1;
  const running = useRoomRunningState(roomId, workerMatrixUserIds);
  const single = useRoomSessionState(roomId, workerMatrixUserIds?.[0], now);
  if (runningOnly) {
    return { state: running ? 'running' : 'idle', runningOnly: true };
  }
  return { state: single, runningOnly: false };
}
