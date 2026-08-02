import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from '@/lib/matrix-api';
import { formatMatrixEvents, isMessageReadByOthers } from './use-matrix';

function message(
  eventId: string,
  body: unknown,
  timestamp: number,
  content: Record<string, unknown> = {}
): MatrixEvent {
  return {
    event_id: eventId,
    sender: '@manager:example.test',
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: { ...content, msgtype: 'm.text', body } as MatrixEvent['content'],
  };
}

describe('formatMatrixEvents', () => {
  it('replaces a root message with its latest revision in the original position', () => {
    const events = [
      message('root', '处理中...', 100),
      message('other', '另一条消息', 200),
      message('revision-1', '第一段回复', 300, {
        'm.relates_to': { rel_type: 'm.replace', event_id: 'root' },
        'm.new_content': { msgtype: 'm.text', body: '第一段回复', streaming: true },
      }),
      message('revision-2', '最终回复', 400, {
        'm.relates_to': { rel_type: 'm.replace', event_id: 'root' },
        'm.new_content': { msgtype: 'm.text', body: '最终回复' },
      }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'root', content: '最终回复', timestamp: 100, isStreaming: false });
    expect(messages[1]).toMatchObject({ id: 'other', content: '另一条消息' });
  });

  it('retains an orphaned revision as an independent message under the root id', () => {
    const events = [
      message('revision', '更新内容', 100, {
        'm.relates_to': { rel_type: 'm.replace', event_id: 'missing-root' },
        'm.new_content': { msgtype: 'm.text', body: '更新内容', 'org.agentteams.streaming': true },
      }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'missing-root', eventId: 'missing-root', content: '更新内容', isStreaming: true, isEdited: true });
  });

  it('extracts text from structured message body parts', () => {
    const events = [
      message('structured', [
        { type: 'text', text: '第一段回复' },
        { type: 'text', text: '第二段回复' },
      ], 100),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('第一段回复\n第二段回复');
  });

  it('serializes structured parts without text instead of coercing them', () => {
    const events = [
      message(
        'tool-call',
        [{ type: 'tool_call', name: 'search', arguments: { query: '状态' } }],
        100
      ),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages[0].content).toBe('{"type":"tool_call","name":"search","arguments":{"query":"状态"}}');
  });

  it('filters thread replies out of the main timeline and counts them on the root', () => {
    const events = [
      message('root', '原始问题', 100),
      message('other', '无关消息', 200),
      message('reply-1', '线程回复一', 300, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }),
      message('reply-2', '线程回复二', 400, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'root', replyCount: 2, isThreadReply: false });
    expect(messages[1]).toMatchObject({ id: 'other' });
  });

  it('exposes threadId on a thread reply event', () => {
    const events = [
      message('root', '原始问题', 100),
      message('reply-1', '线程回复', 200, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages[0]).toMatchObject({ id: 'root', replyCount: 1 });
    // The reply itself is hidden, so no DisplayMessage carries threadId in the main timeline.
    expect(messages.some((m) => m.threadId)).toBe(false);
  });

  it('marks a revised message as edited and keeps the root event id', () => {
    const events = [
      message('root', '原内容', 100),
      message('revision', '* 编辑后', 200, {
        'm.relates_to': { rel_type: 'm.replace', event_id: 'root' },
        'm.new_content': { msgtype: 'm.text', body: '编辑后' },
      }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'root', eventId: 'root', content: '编辑后', isEdited: true });
  });

  it('exposes eventId on a plain message', () => {
    const events = [message('plain', '普通消息', 100)];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages[0]).toMatchObject({ id: 'plain', eventId: 'plain', isEdited: false });
  });

  it('drops messages that were redacted and ignores redaction events', () => {
    const events = [
      message('deleted', '这条被删除了', 100),
      message('kept', '这条还在', 200),
      {
        event_id: 'redaction-1',
        sender: '@human:example.test',
        type: 'm.room.redaction',
        origin_server_ts: 300,
        redacts: 'deleted',
        content: {},
      } as unknown as MatrixEvent,
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'kept' });
  });

  it('skips a redacted message whose content was wiped by the homeserver', () => {
    const events = [
      {
        event_id: 'wiped',
        sender: '@manager:example.test',
        type: 'm.room.message',
        origin_server_ts: 100,
        unsigned: { redacted_because: { event_id: 'redaction-1' } },
        content: {},
      } as unknown as MatrixEvent,
      message('kept', '还在', 200),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'kept' });
  });

  it('extracts the agent run status from org.agentteams.status', () => {
    const events = [
      message('run', '处理中...', 100, { 'org.agentteams.status': 'in_progress' }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages[0].agentStatus).toBe('in_progress');
    expect(messages[0].isStreaming).toBe(true);
  });

  it('leaves agentStatus undefined when no status is present', () => {
    const events = [message('plain', '普通消息', 100)];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages[0].agentStatus).toBeUndefined();
  });
});

describe('isMessageReadByOthers', () => {
  const base = { isMe: true, timestamp: 100 };

  it('returns true when another member has read past the message', () => {
    const receipts = {
      '@agent:example.test': { eventId: '$1', ts: 150 },
    };
    expect(isMessageReadByOthers(base, '@human:example.test', receipts)).toBe(true);
  });

  it('returns false when the other member read receipt is older', () => {
    const receipts = {
      '@agent:example.test': { eventId: '$1', ts: 50 },
    };
    expect(isMessageReadByOthers(base, '@human:example.test', receipts)).toBe(false);
  });

  it('ignores the sender own receipt', () => {
    const receipts = {
      '@human:example.test': { eventId: '$1', ts: 150 },
    };
    expect(isMessageReadByOthers(base, '@human:example.test', receipts)).toBe(false);
  });

  it('returns false for messages that are not mine', () => {
    const receipts = {
      '@agent:example.test': { eventId: '$1', ts: 150 },
    };
    expect(isMessageReadByOthers({ isMe: false, timestamp: 100 }, '@human:example.test', receipts)).toBe(false);
  });

  it('returns false when no receipts exist', () => {
    expect(isMessageReadByOthers(base, '@human:example.test', {})).toBe(false);
  });
});
