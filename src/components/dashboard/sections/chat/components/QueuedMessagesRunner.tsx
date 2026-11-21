'use client';

import { useEffect, useMemo } from 'react';
import { useMatrixRoomMembers, useMatrixRoomMessages, useMatrixSendMessage } from '@/hooks/use-matrix';
import { useMatrixStore } from '@/lib/matrix-store';
import { getDirectExecution } from '@/lib/direct-execution';
import { sendQueuedMessage, useChatMessageQueue, type ChatMessageQueue } from '@/lib/chat-message-queue';

/** Queue workers stay mounted when the user switches rooms or Dashboard sections. */
export function QueuedMessagesRunner() {
  const queues = useChatMessageQueue(state => state.queues);
  const homeserver = useMatrixStore(state => state.homeserver);
  const userId = useMatrixStore(state => state.userId);
  const isLoggedIn = useMatrixStore(state => state.isLoggedIn);
  if (!isLoggedIn) return null;
  return <>{Object.entries(queues).filter(([, queue]) => queue.homeserver === homeserver && queue.userId === userId)
    .map(([key, queue]) => <RoomQueueRunner key={key} queueKey={key} queue={queue} />)}</>;
}

function RoomQueueRunner({ queueKey, queue }: { queueKey: string; queue: ChatMessageQueue }) {
  const messages = useMatrixRoomMessages(queue.roomId);
  const members = useMatrixRoomMembers(queue.roomId);
  const send = useMatrixSendMessage();
  const execution = useMemo(() => {
    if (messages.error || members.error) return null;
    const memberIds = (members.data?.chunk ?? []).filter(event => event.type === 'm.room.member' && event.content.membership === 'join')
      .map(event => event.state_key ?? '');
    return getDirectExecution(messages.data?.pages.flatMap(page => page.chunk) ?? [], queue.userId, memberIds, [queue.agentId]);
  }, [messages.data, messages.error, members.data, members.error, queue.userId, queue.agentId]);
  const first = queue.messages[0]?.id;
  useEffect(() => {
    if (execution && first) void sendQueuedMessage(queueKey, first, execution, send.mutateAsync, true);
  }, [queueKey, first, execution, send.mutateAsync]);
  return null;
}
