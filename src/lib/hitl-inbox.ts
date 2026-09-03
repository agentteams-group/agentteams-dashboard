import { create } from 'zustand';
import { normalizeToBlocks } from '@/lib/a2ui/normalize';
import type { MatrixEvent } from '@/lib/matrix-api';

export interface HitlConfirmation {
  id: string;
  roomId: string;
  eventId: string;
  sender: string;
  toolName: string;
  triggeredBy?: string;
  parameters?: string;
  approveReply: string;
  rejectReply: string;
  timestamp: number;
}

export interface PendingProjectKey {
  id: string;
  team?: string;
}

interface HitlInboxState {
  confirmations: Record<string, HitlConfirmation>;
  pendingChatRoomId: string | null;
  pendingProjectKey: PendingProjectKey | null;
  /** Atomically reads and clears the pending chat room deep-link. */
  takePendingChatRoomId: () => string | null;
  /** Atomically reads and clears the pending project deep-link. */
  takePendingProjectKey: () => PendingProjectKey | null;
  upsertConfirmation: (_item: HitlConfirmation) => void;
  dropConfirmation: (_id: string) => void;
  dropByEventId: (_roomId: string, _eventId: string) => void;
  resolveRoomReply: (_roomId: string, _sender: string, _body: string, _currentUserId: string) => void;
  setPendingChatRoomId: (_roomId: string | null) => void;
  setPendingProjectKey: (_key: PendingProjectKey | null) => void;
  clearConfirmations: () => void;
}

const MAX_CONFIRMATIONS = 50;

export const useHitlInboxStore = create<HitlInboxState>()((set) => ({
  confirmations: {},
  pendingChatRoomId: null,
  pendingProjectKey: null,

  upsertConfirmation: (item) =>
    set((state) => {
      const next = { ...state.confirmations, [item.id]: item };
      const ids = Object.keys(next);
      if (ids.length > MAX_CONFIRMATIONS) {
        const sorted = ids.sort((a, b) => next[a].timestamp - next[b].timestamp);
        for (const id of sorted.slice(0, ids.length - MAX_CONFIRMATIONS)) {
          delete next[id];
        }
      }
      return { confirmations: next };
    }),

  dropConfirmation: (id) =>
    set((state) => {
      if (!(id in state.confirmations)) return state;
      const next = { ...state.confirmations };
      delete next[id];
      return { confirmations: next };
    }),

  dropByEventId: (roomId, eventId) =>
    set((state) => {
      const match = Object.values(state.confirmations).find(
        (item) => item.roomId === roomId && item.eventId === eventId,
      );
      if (!match) return state;
      const next = { ...state.confirmations };
      delete next[match.id];
      return { confirmations: next };
    }),

  resolveRoomReply: (roomId, sender, body, currentUserId) =>
    set((state) => {
      if (sender !== currentUserId || !isHitlResolutionReply(body)) return state;
      const pending = Object.values(state.confirmations)
        .filter((item) => item.roomId === roomId)
        .sort((a, b) => a.timestamp - b.timestamp);
      const target = pending[0];
      if (!target) return state;
      const next = { ...state.confirmations };
      delete next[target.id];
      return { confirmations: next };
    }),

  setPendingChatRoomId: (roomId) => set({ pendingChatRoomId: roomId }),
  setPendingProjectKey: (key) => set({ pendingProjectKey: key }),
  takePendingChatRoomId: () => {
    const current = useHitlInboxStore.getState().pendingChatRoomId;
    if (current) {
      useHitlInboxStore.setState({ pendingChatRoomId: null });
    }
    return current;
  },
  takePendingProjectKey: () => {
    const current = useHitlInboxStore.getState().pendingProjectKey;
    if (current) {
      useHitlInboxStore.setState({ pendingProjectKey: null });
    }
    return current;
  },
  clearConfirmations: () => set({ confirmations: {} }),
}));

export function selectConfirmationList(
  confirmations: Record<string, HitlConfirmation>,
): HitlConfirmation[] {
  return Object.values(confirmations).sort((a, b) => b.timestamp - a.timestamp);
}

export function isHitlResolutionReply(body: string): boolean {
  const text = body.trim();
  return text === '/approve' || text === '拒绝';
}

export function resolveEventContent(event: MatrixEvent): Record<string, unknown> {
  const raw = (event.content ?? {}) as Record<string, unknown>;
  const relatesTo = raw['m.relates_to'] as { rel_type?: string } | undefined;
  if (relatesTo?.rel_type === 'm.replace') {
    const newContent = raw['m.new_content'] as Record<string, unknown> | undefined;
    if (newContent && typeof newContent === 'object') {
      return { ...raw, ...newContent };
    }
  }
  return raw;
}

export function rootEventIdOf(event: MatrixEvent): string {
  const relatesTo = event.content?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  if (relatesTo?.rel_type === 'm.replace' && typeof relatesTo.event_id === 'string' && relatesTo.event_id) {
    return relatesTo.event_id;
  }
  return event.event_id;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function extractConfirmationFromEvent(
  event: MatrixEvent,
  roomId: string,
): HitlConfirmation | null {
  if (event.type !== 'm.room.message') return null;
  const content = resolveEventContent(event);
  const body = typeof content.body === 'string' ? content.body : '';
  const formattedBody = typeof content.formatted_body === 'string' ? content.formatted_body : undefined;

  const blocks = normalizeToBlocks({
    body,
    formattedBody,
    content,
    isStreaming: false,
  });
  const confirmation = blocks.find((block) => block.type === 'confirmation');
  if (!confirmation) return null;

  const payload = (confirmation.payload ?? {}) as Record<string, unknown>;
  const toolName = asString(payload.toolName) ?? asString(payload.tool_name) ?? '未知工具';
  const confirmationId = asString(payload.confirmation_id);
  const eventId = rootEventIdOf(event);

  return {
    id: confirmationId ?? `${roomId}:${eventId}`,
    roomId,
    eventId,
    sender: event.sender,
    toolName,
    triggeredBy: asString(payload.triggeredBy),
    parameters: asString(payload.parameters),
    approveReply: asString(payload.approveReply) ?? '/approve',
    rejectReply: asString(payload.rejectReply) ?? '拒绝',
    timestamp: event.origin_server_ts,
  };
}

export function ingestHitlTimelineEvents(
  roomId: string,
  events: MatrixEvent[],
  currentUserId: string,
): void {
  const store = useHitlInboxStore.getState();
  const ordered = [...events].sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  for (const event of ordered) {
    if (event.type !== 'm.room.message') continue;
    const confirmation = extractConfirmationFromEvent(event, roomId);
    if (confirmation) {
      store.upsertConfirmation(confirmation);
      continue;
    }
    // Non-confirmation message: resolve any pending approval, then drop by
    // event id if this is an m.replace revision (streaming finalization).
    const content = resolveEventContent(event);
    const body = typeof content.body === 'string' ? content.body : '';
    store.resolveRoomReply(roomId, event.sender, body, currentUserId);
    const relatesTo = event.content?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
    if (relatesTo?.rel_type === 'm.replace' && relatesTo.event_id) {
      store.dropByEventId(roomId, relatesTo.event_id);
    }
  }
}
