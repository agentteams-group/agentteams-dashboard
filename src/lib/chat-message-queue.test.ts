import { beforeEach, expect, it, vi } from 'vitest';
import { chatQueueKey, sendQueuedMessage, useChatMessageQueue } from './chat-message-queue';
import type { DirectExecution } from './direct-execution';

const scope = { homeserver: 'https://matrix.test', userId: '@me:test', roomId: '!room:test', agentId: '@agent:test' };
const key = chatQueueKey(scope);
const execution: DirectExecution = { agentId: scope.agentId, runId: '$run', status: 'completed' };
const enqueue = (body: string) => useChatMessageQueue.getState().enqueue(scope, { roomId: scope.roomId, body });
const messages = () => useChatMessageQueue.getState().queues[key]?.messages ?? [];
beforeEach(() => useChatMessageQueue.setState({ queues: {} }));

it('releases exactly one FIFO input per completed run, including before the next run starts', async () => {
  const first = enqueue('first'); enqueue('second'); enqueue('third');
  const send = vi.fn().mockResolvedValue({ event_id: '$sent' });
  await sendQueuedMessage(key, first, execution, send, true);
  expect(send.mock.calls[0][0]).toEqual({ roomId: scope.roomId, body: 'first' });
  const second = messages()[0].id;
  expect(await sendQueuedMessage(key, second, execution, send, true)).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  expect(messages().map(message => message.request.body)).toEqual(['second', 'third']);
  await sendQueuedMessage(key, second, { ...execution, runId: '$sent' }, send, true);
  expect(send).toHaveBeenCalledTimes(2);
  expect(messages()[0].request.body).toBe('third');
});

it.each(['running', 'stopping', 'stopped', 'failed', 'unavailable'] as const)('does not automatically drain on %s', async status => {
  const id = enqueue('wait'); const send = vi.fn();
  expect(await sendQueuedMessage(key, id, { ...execution, status }, send, true)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(messages()).toHaveLength(1);
});

it('sends a selected later input as native steer and keeps the remaining order', async () => {
  enqueue('first'); const id = enqueue('correction'); enqueue('third');
  const send = vi.fn().mockResolvedValue({ event_id: '$steer' });
  await sendQueuedMessage(key, id, { ...execution, status: 'running' }, send);
  expect(send.mock.calls[0][0]).toMatchObject({ body: 'correction', extra: {
    'com.agentteams.control': { action: 'steer', agent_id: scope.agentId, run_id: '$run' },
  } });
  expect(messages().map(message => message.request.body)).toEqual(['first', 'third']);
});

it('holds the room lock across concurrent manual and automatic sends', async () => {
  const first = enqueue('first'); const second = enqueue('second');
  let finish!: (_value: { event_id: string }) => void;
  const send = vi.fn(() => new Promise<{ event_id: string }>(resolve => { finish = resolve; }));
  const pending = sendQueuedMessage(key, first, execution, send, true);
  expect(await sendQueuedMessage(key, second, execution, send)).toBe(false);
  useChatMessageQueue.getState().remove(key, first);
  expect(messages()).toHaveLength(2);
  finish({ event_id: '$sent' }); await pending;
  expect(messages()).toHaveLength(1);
});

it('retains failed input for explicit retry instead of draining or dropping it', async () => {
  const id = enqueue('keep me'); enqueue('next');
  const send = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue({ event_id: '$sent' });
  expect(await sendQueuedMessage(key, id, execution, send, true)).toBe(false);
  expect(messages()[0].error).toBe('network unavailable');
  expect(await sendQueuedMessage(key, id, execution, send, true)).toBe(false);
  await sendQueuedMessage(key, id, execution, send);
  expect(messages()[0].request.body).toBe('next');
});

it('isolates rooms and refuses to steer a different Agent', async () => {
  const id = enqueue('first');
  const other = { ...scope, roomId: '!other:test' };
  useChatMessageQueue.getState().enqueue(other, { roomId: other.roomId, body: 'other room' });
  const send = vi.fn();
  expect(await sendQueuedMessage(key, id, { ...execution, agentId: '@other:test' }, send)).toBe(false);
  useChatMessageQueue.getState().remove(key, id);
  expect(useChatMessageQueue.getState().queues[key]).toBeUndefined();
  expect(useChatMessageQueue.getState().queues[chatQueueKey(other)].messages[0].request.body).toBe('other room');
});
