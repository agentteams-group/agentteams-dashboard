// Matrix /sync `rooms.invite` store.
//
// The global Matrix sync loop (useGlobalMatrixSync) calls `upsertInvite` for
// every entry in `rooms.invite` and `dropByRoomId` when the same roomId
// shows up under `rooms.join` or `rooms.leave`. The chat sidebar renders an
// inbox from this store; the HITL dashboard card reads `pendingCount()` for
// its counter. State is intentionally client-side: invites are per-account
// and only meaningful to the operator's local session.
//
// The store also exposes `pendingInboxJump` — a one-shot deep-link that the
// HITL card sets when the operator taps the "open chat inbox" row. The chat
// sidebar reads it during render (atomic consumer pattern, same as
// useHitlInboxStore.takePendingChatRoomId) so the click never needs an
// effect setState (react-hooks/set-state-in-effect disallows that path).

import { create } from 'zustand';

export interface Invite {
  roomId: string;
  /** Sender MXID. Display name is not strictly available in /sync without a
   *  state roundtrip; the sidebar falls back to the localpart when needed. */
  sender: string;
  /** Best-effort room display name (m.room.name from invite_state, may be
   *  absent for direct 1:1 invites). Falls back to roomId in the UI. */
  roomName?: string;
  /** Origin server timestamp of the invite event (ms). */
  originTs?: number;
}

interface InviteStoreState {
  invites: Record<string, Invite>;
  /** Deep-link flag for the HITL → chat-sidebar jump. Atomic consumer. */
  pendingInboxJump: boolean;
  takePendingInbox: () => boolean;
  upsertInvite: (_invite: Invite) => void;
  dropByRoomId: (_roomId: string) => void;
  pendingCount: () => number;
  setPendingInbox: () => void;
  clear: () => void;
}

export const useInviteStore = create<InviteStoreState>()((set, get) => ({
  invites: {},
  pendingInboxJump: false,

  takePendingInbox: () => {
    const current = get().pendingInboxJump;
    if (current) set({ pendingInboxJump: false });
    return current;
  },

  upsertInvite: (invite) =>
    set((state) => ({ invites: { ...state.invites, [invite.roomId]: invite } })),

  dropByRoomId: (roomId) =>
    set((state) => {
      if (!state.invites[roomId]) return state;
      const next = { ...state.invites };
      delete next[roomId];
      return { invites: next };
    }),

  pendingCount: () => Object.keys(get().invites).length,

  setPendingInbox: () => set({ pendingInboxJump: true }),

  clear: () => set({ invites: {}, pendingInboxJump: false }),
}));