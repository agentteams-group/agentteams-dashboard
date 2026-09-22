// Worker session running indicator (A17) — pure frontend derivation,
// zero backend changes.
//
// Logic is a 1:1 port of the workbench plugin's workerSessionState
// (v1.51 design freeze, beta.12.4): same constants, same priority,
// same boundary values — one source of truth, two implementations.
//
// Data sources (both already ingested by the existing /sync loop):
//   useTypingStore.typingUsers[roomId]  — m.typing events (the worker
//   sends typing while processing, 25s keep-alive, hard 2min cap — a
//   long task >2min drops out of typing; the UI therefore expresses
//   "active processing within the last ~2 minutes")
//   useRoomMetaStore.meta[roomId].lastMessageTs — last message ts
//
// State machine (9/14 design freeze; palette:
//   blue = running (breathing) / green = finished / gray = no task):
//   running = the worker's MXID is in the room's typing[]
//   done    = not running and activity within the last 10 minutes
//   idle    = everything else
//
// done boundary semantics (1:1 rooms): lastMessageTs does not
// distinguish the sender — in the short window between "the user just
// sent a task" and "the worker starts typing" the dot may flash green
// briefly. Workers start typing on receipt (matrix_channel verified),
// so the window is tiny; accepted.
// Team rooms have no per-user last-sender data (zero-backend
// constraint) → team rooms only express running (a worker is typing),
// never done/idle (avoids human messages triggering green).

import type { WorkerSessionState, SessionRoomLike } from './worker-session-state-types';

/**
 * Task-level (heartbeat) status — the r12c data model kept alongside the
 * zero-backend session model above. Luo-zong 9/14: the 120s typing ceiling
 * is unacceptable, so the controller heartbeat `agentStatus` is the
 * authoritative "running" source (unbounded); typing is the realtime
 * fallback; a recent finish is green and decays after 10 minutes.
 *
 *   running  = agentStatus "running" / runningTaskCount>0 / typing now
 *   done     = finished (lastFinishAt or last message) within 10 min
 *   idle     = everything else
 *
 * Older controllers without the agentStatus fields degrade gracefully to
 * typing + last-message-age.
 */
export interface WorkerAgentStatusInfo {
  agentStatus?: string;
  runningTaskCount?: number;
  lastFinishAt?: string;
  lastRunAt?: string;
}

/** Window after which a "done" (green) dot decays to idle (gray). */
export const DONE_DECAY_MS = 10 * 60 * 1000;

/**
 * Phases in which the worker process is known to be inactive. In these
 * phases no live typing/heartbeat signal can be authoritative — the
 * session dot is forced to 'idle' so the card (which shows the container
 * phase via StatusDot/PhaseBadge) cannot render a "running" dot next to
 * a stopped container.
 */
export const INACTIVE_PHASES = new Set<string>(['Stopped', 'Failed', 'Sleeping', 'Pending']);

export function deriveWorkerSessionState(opts: {
  agentStatus?: WorkerAgentStatusInfo | null;
  isTyping: boolean;
  /** Epoch ms of the worker's latest message in this room (0/undefined = none). */
  lastMessageTs?: number;
  now: number;
  /**
   * Container/process-level phase from the backend. When the phase is in
   * INACTIVE_PHASES the dot is forced to 'idle' regardless of typing /
   * heartbeat, because those signals can lag a container stop by minutes
   * (typing keep-alive has no ceiling; lastFinishAt decays over 10 min).
   */
  phase?: string;
}): WorkerSessionState {
  const { agentStatus, isTyping, lastMessageTs, now, phase } = opts;
  if (phase && INACTIVE_PHASES.has(phase)) return 'idle';

  // 1) Task-level truth from the heartbeat — no time ceiling.
  if (
    agentStatus?.agentStatus === 'running' ||
    (agentStatus?.runningTaskCount ?? 0) > 0
  ) {
    return 'running';
  }
  // 2) Realtime typing signal — the worker is actively producing.
  if (isTyping) return 'running';
  // 3) Recently finished → green, decaying.
  const finishTs = agentStatus?.lastFinishAt
    ? Date.parse(agentStatus.lastFinishAt)
    : Number.NaN;
  const recentTs = Number.isFinite(finishTs) && finishTs > 0 ? finishTs : (lastMessageTs ?? 0);
  if (recentTs > 0 && now - recentTs < DONE_DECAY_MS) return 'done';
  return 'idle';
}

/** done window: last activity ≤ 10min ago counts as "just finished". */
export const DONE_WINDOW_MS = 10 * 60 * 1000;
/** Aging tick: re-derive every 60s (the done→idle flip needs no new message). */
export const TICK_MS = 60 * 1000;

/**
 * Per-worker three-state: derived across all rooms by worker MXID.
 * `phase` (optional) is the container-level phase; when it is in
 * INACTIVE_PHASES the result is forced to 'idle' so the dot cannot
 * claim "running" while the container is stopped (see deriveWorkerSessionState).
 */
export function workerSessionState(
  mxid: string | undefined,
  rooms: readonly SessionRoomLike[],
  now: number = Date.now(),
  phase?: string,
): WorkerSessionState {
  if (phase && INACTIVE_PHASES.has(phase)) return 'idle';
  if (!mxid) return 'idle';
  for (const r of rooms) {
    if ((r.typing || []).includes(mxid)) return 'running';
  }
  for (const r of rooms) {
    if (
      r.lastMessageTs &&
      now - r.lastMessageTs <= DONE_WINDOW_MS &&
      r.memberIds &&
      r.memberIds.includes(mxid)
    ) {
      return 'done';
    }
  }
  return 'idle';
}

/**
 * Room-level: any worker typing in the room → running; else by the
 * room's last activity. For team rooms callers must treat the result
 * as running-only (never render done/idle — see the module header).
 */
export function roomWorkerState(
  room: SessionRoomLike,
  workerMxids: ReadonlySet<string>,
  now: number = Date.now(),
): WorkerSessionState {
  for (const m of room.typing || []) {
    if (workerMxids.has(m)) return 'running';
  }
  if (room.lastMessageTs && now - room.lastMessageTs <= DONE_WINDOW_MS) return 'done';
  return 'idle';
}

/**
 * Team-room running check only: true when any of the room's workers is
 * typing right now. Deliberately no done/idle (v1.51 decision).
 */
export function roomHasRunningWorker(
  room: SessionRoomLike,
  workerMxids: readonly string[] | undefined,
): boolean {
  if (!workerMxids || workerMxids.length === 0) return false;
  const set = new Set(workerMxids);
  return (room.typing || []).some((m) => set.has(m));
}

export type { WorkerSessionState, SessionRoomLike };
