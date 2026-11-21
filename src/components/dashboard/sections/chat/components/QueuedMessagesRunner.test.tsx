import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueuedMessagesRunner } from './QueuedMessagesRunner';
import { chatQueueKey, useChatMessageQueue } from '@/lib/chat-message-queue';
import { useMatrixStore } from '@/lib/matrix-store';
import type { MatrixEvent } from '@/lib/matrix-api';

const mocks = vi.hoisted(() => ({
  events: [] as MatrixEvent[], memberError: null as Error | null,
  send: vi.fn(),
}));
vi.mock('@/hooks/use-matrix', () => ({
  useMatrixRoomMessages: () => ({ data: { pages: [{ chunk: mocks.events }] }, error: null }),
  useMatrixRoomMembers: () => ({ data: { chunk: ['@me:test', '@agent:test'].map(id => ({
    type: 'm.room.member', state_key: id, content: { membership: 'join' },
  })) }, error: mocks.memberError }),
  useMatrixSendMessage: () => ({ mutateAsync: mocks.send }),
}));
const scope = { homeserver: 'https://matrix.test', userId: '@me:test', roomId: '!room:test', agentId: '@agent:test' };
const key = chatQueueKey(scope);
function status(run: string, value: string, ts: number): MatrixEvent {
  return { event_id: `$${run}-${value}`, sender: '@agent:test', type: 'm.room.message', origin_server_ts: ts,
    content: { 'com.agentteams.execution': { run_id: run, status: value, capabilities: ['stop', 'steer'] } } };
}
beforeEach(() => {
  mocks.events = [status('$original', 'running', 1)];
  mocks.memberError = null;
  mocks.send.mockReset().mockResolvedValue({ event_id: '$next' });
  useChatMessageQueue.setState({ queues: {} });
  useMatrixStore.setState({ ...scope, isLoggedIn: true });
});
afterEach(cleanup);

it('drains in the background without a mounted ChatRoom and waits for the next completed run', async () => {
  const view = render(<QueuedMessagesRunner />);
  act(() => {
    for (const body of ['first', 'second']) useChatMessageQueue.getState().enqueue(scope, { roomId: scope.roomId, body });
  });
  expect(mocks.send).not.toHaveBeenCalled();
  mocks.events = [...mocks.events, status('$original', 'completed', 2)];
  view.rerender(<QueuedMessagesRunner />);
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(useChatMessageQueue.getState().queues[key].messages).toHaveLength(1));
  view.rerender(<QueuedMessagesRunner />);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  mocks.events = [...mocks.events, status('$next', 'running', 3), status('$next', 'completed', 4)];
  view.rerender(<QueuedMessagesRunner />);
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
  expect(mocks.send.mock.calls.map(([request]) => request.body)).toEqual(['first', 'second']);
  expect(mocks.send.mock.calls.every(([request]) => !request.extra?.['com.agentteams.control'])).toBe(true);
});

it('does not send across a login change, even if the old room completed', async () => {
  useChatMessageQueue.getState().enqueue(scope, { roomId: scope.roomId, body: 'private input' });
  mocks.events = [...mocks.events, status('$original', 'completed', 2)];
  useMatrixStore.setState({ userId: '@other:test' });
  render(<QueuedMessagesRunner />);
  await act(async () => {});
  expect(mocks.send).not.toHaveBeenCalled();
  expect(useChatMessageQueue.getState().queues[key].messages).toHaveLength(1);
});

it('does not use stale member data after a membership fetch fails', () => {
  useChatMessageQueue.getState().enqueue(scope, { roomId: scope.roomId, body: 'wait' });
  mocks.events = [...mocks.events, status('$original', 'completed', 2)];
  mocks.memberError = new Error('Forbidden');
  render(<QueuedMessagesRunner />);
  expect(mocks.send).not.toHaveBeenCalled();
});
