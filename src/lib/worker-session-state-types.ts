export type WorkerSessionState = 'running' | 'done' | 'idle';


/** Minimal room shape the derivation needs (test objects may be lean). */
export interface SessionRoomLike {
  /** MXIDs currently typing in the room (m.typing, ≤2min). */
  typing?: string[];
  /** Last message timestamp in the room (epoch ms). */
  lastMessageTs?: number;
  /** Member MXIDs of the room (member gate for the done state). */
  memberIds?: string[];
}
