import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';

/**
 * Navigate from any dashboard surface to a Matrix chat room.
 *
 * Side effect: switches the active section to `chat` and stashes the target
 * room id on the HITL inbox store so `ChatSection` can pick it up during its
 * `takePendingChatRoomId` read.
 *
 * Use this helper whenever a non-chat surface (Worker cards, HITL inbox,
 * Tasks CTA, etc.) needs to deep-link into a specific conversation. Keeping a
 * single entry point ensures the two store writes stay in lockstep.
 */
export function openChatRoom(roomId: string | null | undefined, taskId?: string, target?: 'mention'): void {
  if (!roomId) return;
  useHitlInboxStore.getState().setPendingChatRoomId(roomId);
  useSectionStore.setState({ activeSection: 'chat', taskCollaboration: taskId ? { taskId, roomId } : null, mentionRoomId: target === 'mention' ? roomId : null });
}
