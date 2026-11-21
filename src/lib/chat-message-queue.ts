'use client';

import { create } from 'zustand';
import type { useMatrixSendMessage } from '@/hooks/use-matrix';
import { CONTROL_KEY, executionControl, type DirectExecution } from './direct-execution';

export type QueuedMessageRequest = Parameters<ReturnType<typeof useMatrixSendMessage>['mutateAsync']>[0];
export interface ChatQueueScope {
  homeserver: string;
  userId: string;
  roomId: string;
  agentId: string;
}
export interface QueuedChatMessage {
  id: string;
  request: QueuedMessageRequest;
  error?: string;
}
export interface ChatMessageQueue extends ChatQueueScope {
  messages: QueuedChatMessage[];
  sendingId?: string;
  lastReleasedRunId?: string;
}

export function chatQueueKey(scope: Pick<ChatQueueScope, 'homeserver' | 'userId' | 'roomId'>): string {
  return JSON.stringify([scope.homeserver, scope.userId, scope.roomId]);
}

interface QueueStore {
  queues: Record<string, ChatMessageQueue>;
  enqueue: (_scope: ChatQueueScope, _request: QueuedMessageRequest) => string;
  remove: (_key: string, _id: string) => void;
}

// Keep queues through room/section switches, scoped to this browser tab's
// account and homeserver. No credentials or unsent input is stored on disk.
export const useChatMessageQueue = create<QueueStore>((set) => ({
  queues: {},
  enqueue: (scope, request) => {
    const id = crypto.randomUUID();
    const key = chatQueueKey(scope);
    set(({ queues }) => ({ queues: { ...queues, [key]: {
      ...(queues[key] ?? { ...scope, messages: [] }),
      messages: [...(queues[key]?.messages ?? []), { id, request }],
    } } }));
    return id;
  },
  remove: (key, id) => set(({ queues }) => {
    const queue = queues[key];
    if (!queue || queue.sendingId === id) return {};
    const messages = queue.messages.filter(message => message.id !== id);
    const next = { ...queues };
    if (messages.length) next[key] = { ...queue, messages };
    else delete next[key];
    return { queues: next };
  }),
}));

export async function sendQueuedMessage(
  key: string,
  id: string,
  execution: DirectExecution,
  send: (_request: QueuedMessageRequest) => Promise<{ event_id: string }>,
  automatic = false,
): Promise<boolean> {
  const queue = useChatMessageQueue.getState().queues[key];
  const message = queue?.messages.find(item => item.id === id);
  if (!queue || !message || queue.sendingId || queue.agentId !== execution.agentId) return false;
  if (automatic && (execution.status !== 'completed' || queue.lastReleasedRunId === execution.runId
    || queue.messages[0].id !== id || message.error)) return false;

  // Consume the completion before awaiting delivery. Its old receipt must not
  // release another entry while the next Agent run is still starting.
  useChatMessageQueue.setState(({ queues }) => ({ queues: { ...queues, [key]: {
    ...queue, sendingId: id,
    lastReleasedRunId: execution.status === 'completed' ? execution.runId : queue.lastReleasedRunId,
  } } }));
  try {
    const steer = !automatic && (execution.status === 'running' || execution.status === 'stopping');
    await send({ ...message.request, ...(steer ? { extra: {
      ...message.request.extra, [CONTROL_KEY]: executionControl(execution, 'steer'),
    } } : {}) });
    useChatMessageQueue.setState(({ queues }) => {
      const current = queues[key];
      if (!current) return {};
      const messages = current.messages.filter(item => item.id !== id);
      const next = { ...queues };
      if (messages.length) next[key] = { ...current, messages, sendingId: undefined };
      else delete next[key];
      return { queues: next };
    });
    return true;
  } catch (error) {
    useChatMessageQueue.setState(({ queues }) => ({ queues: { ...queues, [key]: {
      ...queues[key], sendingId: undefined,
      messages: queues[key].messages.map(item => item.id === id
        ? { ...item, error: error instanceof Error ? error.message : '发送失败，请重试' } : item),
    } } }));
    return false;
  }
}
