import type { DisplayMessage } from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';

export function indexRoomReplies(messages: DisplayMessage[], events: MatrixEvent[]) {
  const byEventId = new Map<string, DisplayMessage>();
  for (const message of messages) {
    for (const id of [message.id, message.eventId, ...(message.sourceEventIds ?? [])]) {
      if (id) byEventId.set(id, message);
    }
  }
  // A native thread reply may be absent from the visible timeline.
  const threadParents = new Map<string, string>();
  for (const event of events) {
    const relation = event.content['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
    if (relation?.rel_type === 'm.thread' && relation.event_id) {
      threadParents.set(event.event_id, relation.event_id);
    }
  }

  const repliesByRoot = new Map<string, DisplayMessage[]>();
  const rootByReply = new Map<string, DisplayMessage>();
  for (const reply of messages) {
    if (!reply.replyToEventId || reply.isThreadReply) continue;
    const visited = new Set([reply.id]);
    let targetId: string | undefined = reply.replyToEventId;
    while (targetId && !visited.has(targetId)) {
      visited.add(targetId);
      const threadParent = threadParents.get(targetId);
      if (threadParent) {
        targetId = threadParent;
        continue;
      }
      const target = byEventId.get(targetId);
      if (!target || target.id === reply.id) break;
      targetId = target.replyToEventId;
      if (targetId) continue;
      rootByReply.set(reply.id, target);
      const replies = repliesByRoot.get(target.id) ?? [];
      replies.push(reply);
      repliesByRoot.set(target.id, replies);
    }
  }
  return { repliesByRoot, rootByReply };
}
