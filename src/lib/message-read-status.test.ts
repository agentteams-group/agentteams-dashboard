import { describe, expect, it } from 'vitest';
import { READ_AUDIENCE_KEY, SESSION_RECEIPT_TYPE, messageReadMembers } from './message-read-status';
import type { MatrixEvent } from './matrix-api';

const audience = {
  version: 1,
  members: [
    { user_id: '@me:hs', display_name: '我', kind: 'human' },
    { user_id: '@alice:hs', display_name: 'Alice', kind: 'agent' },
    { user_id: '@bob:hs', display_name: 'Bob', kind: 'agent' },
    { user_id: '@old:hs', display_name: '旧 Agent', kind: 'agent' },
    { user_id: '@carol:hs', display_name: 'Carol', kind: 'human' },
  ],
};
const message = { eventId: '$m', sender: '@me:hs', rawContent: { [READ_AUDIENCE_KEY]: audience } };
const receipt = (sender: string, status: string, target = '$m'): MatrixEvent => ({
  event_id: `$${sender}-${status}`, sender, type: SESSION_RECEIPT_TYPE, origin_server_ts: 300,
  content: { version: 1, status, 'm.relates_to': { rel_type: SESSION_RECEIPT_TYPE, event_id: target } },
});

describe('per-message read members', () => {
  const evidence = [receipt('@alice:hs', 'read'), receipt('@bob:hs', 'received')];

  it('shows only explicitly mentioned members and hides unsupported Agents', () => {
    expect(messageReadMembers({ ...message, rawContent: { ...message.rawContent, 'm.mentions': { user_ids: ['@bob:hs', '@old:hs'] } } }, evidence, {}))
      .toEqual([{ userId: '@bob:hs', displayName: 'Bob', state: 'unread', kind: 'agent' }]);
  });

  it('uses the captured audience without adding later joins or the sender', () => {
    expect(messageReadMembers(message, evidence, {}).map((m) => [m.userId, m.state]))
      .toEqual([['@alice:hs', 'read'], ['@bob:hs', 'unread'], ['@carol:hs', 'unread']]);
  });

  it('room mentions include the whole captured audience', () => {
    expect(messageReadMembers({ ...message, rawContent: { ...message.rawContent, 'm.mentions': { room: true, user_ids: ['@alice:hs'] } } }, evidence, {})).toHaveLength(3);
  });

  it('ignores a delayed receipt for another message and does not regress read', () => {
    expect(messageReadMembers(message, [receipt('@alice:hs', 'read', '$older'), receipt('@bob:hs', 'read'), receipt('@bob:hs', 'received')], {})
      .map((m) => [m.userId, m.state])).toEqual([['@bob:hs', 'read'], ['@carol:hs', 'unread']]);
  });

  it('uses resolved event positions for humans, never receipt send time', () => {
    expect(messageReadMembers(message, [], { '@carol:hs': { eventId: '$older', ts: 9999 } })[0].state).toBe('unread');
    expect(messageReadMembers(message, [], { '@carol:hs': { eventId: '$m', ts: 0 } })[0].state).toBe('read');
  });

  it('hides legacy messages without a captured audience', () => {
    expect(messageReadMembers({ ...message, rawContent: {} }, evidence, {})).toEqual([]);
  });

  it('requires acknowledgement of an edit instead of reusing the original read', () => {
    expect(messageReadMembers({ ...message, latestEventId: '$edit' }, [...evidence, receipt('@alice:hs', 'received', '$edit')], {})[0].state).toBe('unread');
  });

  it('does not count another thread as a human read of this message', () => {
    expect(messageReadMembers({ ...message, threadId: '$thread-a' }, [], { '@carol:hs': { eventId: '$m', ts: 9999, threadId: '$thread-b' } })[0].state).toBe('unread');
  });
});
