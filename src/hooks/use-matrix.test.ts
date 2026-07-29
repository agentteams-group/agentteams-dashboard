import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from '@/lib/matrix-api';
import { formatMatrixEvents } from './use-matrix';

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

  it('retains an orphaned revision as an independent message', () => {
    const events = [
      message('revision', '更新内容', 100, {
        'm.relates_to': { rel_type: 'm.replace', event_id: 'missing-root' },
        'm.new_content': { msgtype: 'm.text', body: '更新内容', 'org.agentteams.streaming': true },
      }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'revision', content: '更新内容', isStreaming: true });
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
});
