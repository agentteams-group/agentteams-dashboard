import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from '@/lib/matrix-api';
import { formatMatrixEvent, formatMatrixEvents, isMessageReadByOthers } from './use-matrix';

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
  it('sorts an agent revision at the edit time so the final answer follows later messages', () => {
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
    expect(messages[0]).toMatchObject({ id: 'other', content: '另一条消息' });
    expect(messages[1]).toMatchObject({ id: 'root', content: '最终回复', timestamp: 400, isStreaming: false });
  });

  it('keeps a human-edited message in its original position', () => {
    const events = [
      { ...message('mine', '原内容', 100), sender: '@human:example.test' },
      message('other', '另一条消息', 200),
      {
        ...message('revision', '* 修正错别字', 400, {
          'm.relates_to': { rel_type: 'm.replace', event_id: 'mine' },
          'm.new_content': { msgtype: 'm.text', body: '修正错别字' },
        }),
        sender: '@human:example.test',
      },
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'mine', content: '修正错别字', timestamp: 100, isEdited: true });
    expect(messages[1]).toMatchObject({ id: 'other' });
  });

  it('orders thinking and tool process messages before the final edited answer', () => {
    // Hermes run: placeholder → m.thread thinking → m.thread tool call →
    // m.replace final answer. The final answer must land at the bottom.
    const events = [
      message('root', '处理中...', 100, { msgtype: 'm.notice' }),
      message('thinking', 'Let me check the current status.', 200, {
        msgtype: 'm.notice',
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }),
      message('tool', '🔧 **teamharness__taskflow**\n```\n{"action":"check_task"}\n```', 300, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }),
      message('final', '* 最终汇报', 400, {
        'm.relates_to': { rel_type: 'm.replace', event_id: 'root' },
        'm.new_content': { msgtype: 'm.text', body: '最终汇报' },
      }),
      { ...message('user', '@leader 最新进展', 50), sender: '@human:example.test' },
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages.map((m) => m.id)).toEqual(['user', 'thinking', 'tool', 'root']);
    expect(messages[3]).toMatchObject({ id: 'root', content: '最终汇报', isEdited: true });
    expect(messages[1]).toMatchObject({ threadId: 'root', isThreadReply: true });
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

  it('keeps structured Agent run blocks on the revised root message', () => {
    const events = [
      message('agent-root', '处理中...', 100),
      message('agent-revision', '最终答案', 200, {
        'm.relates_to': { rel_type: 'm.replace', event_id: 'agent-root' },
        'm.new_content': {
          msgtype: 'm.text',
          body: '最终答案',
          'org.agentteams.run': {
            run_id: 'run-1',
            blocks: [
              { type: 'thinking', content: '正在分析', isStreaming: false },
              { type: 'tool_call', payload: { tool_name: 'read_file', status: 'completed', result: 'ok' } },
              { type: 'text', text: '最终答案' },
            ],
          },
        },
      }),
    ];

    const [displayMessage] = formatMatrixEvents(events, '@human:example.test');

    expect(displayMessage).toMatchObject({ id: 'agent-root', content: '最终答案', isEdited: true });
    expect(displayMessage.agentBlocks).toEqual([
      { type: 'thinking', content: '正在分析' },
      { type: 'tool_call', payload: { tool_name: 'read_file', status: 'completed', result: 'ok' } },
      { type: 'text', text: '最终答案' },
    ]);
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

  it('keeps cross-user thread replies out of the main timeline and counts them on the root', () => {
    // Thread replies from a different sender than the root go to the thread panel.
    const events = [
      { ...message('root', '原始问题', 100), sender: '@bot:example.test' },
      message('other', '无关消息', 200),
      { ...message('reply-1', '线程回复一', 300, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }), sender: '@human:example.test' },
      { ...message('reply-2', '线程回复二', 400, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }), sender: '@human:example.test' },
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'root', replyCount: 2, isThreadReply: false });
    expect(messages[1]).toMatchObject({ id: 'other' });
  });

  it('keeps self-thread-replies in the main timeline (agent continuing its own response)', () => {
    // When an agent sends a thread reply to its own root (e.g. Hermes
    // delivering the main answer), keep it inline so it's visible.
    const events = [
      message('root', '处理中...', 100),
      message('reply-1', '实际回答', 200, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }),
      message('other', '另一条消息', 300),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('root');
    expect(messages[0].replyCount).toBeFalsy();
    expect(messages[1]).toMatchObject({ id: 'reply-1', isThreadReply: true, threadId: 'root' });
    expect(messages[2]).toMatchObject({ id: 'other' });
  });

  it('keeps agent thread replies to user messages inline (final answer should not go to sub-thread)', () => {
    // When an agent replies to the user's question via m.thread, the answer
    // should stay in the main timeline instead of being hidden in a thread
    // panel. This matches Hermes's pattern where the agent delivers its
    // final answer as a thread reply to the user's original message.
    const events = [
      message('user-q', '汇报下worker状态', 100),
      message('agent-reply', 'tm3 状态：空闲，待命', 200, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'user-q' },
      }),
    ];

    const messages = formatMatrixEvents(events, '@human:example.test');

    expect(messages).toHaveLength(2);
    // agent-reply should be inline, not counted as thread reply
    expect(messages[0]).toMatchObject({ id: 'user-q' });
    expect(messages[1]).toMatchObject({
      id: 'agent-reply',
      isThreadReply: true,
      threadId: 'user-q',
      content: 'tm3 状态：空闲，待命',
    });
    expect(messages[0].replyCount).toBeFalsy();
  });

  it('exposes thread metadata before the reply enters the thread panel', () => {
    const reply = formatMatrixEvent(
      message('reply-1', '线程回复', 200, {
        'm.relates_to': { rel_type: 'm.thread', event_id: 'root' },
      }),
      '@human:example.test'
    );

    expect(reply).toMatchObject({ id: 'reply-1', threadId: 'root', isThreadReply: true });
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

  it('extracts an AgentTeams workflow payload from a Matrix message', () => {
    const workflow = {
      title: '发布流程',
      status: 'in_progress',
      runId: 'run-1',
      steps: [{ id: 'plan', title: '规划', status: 'completed' }],
    };
    const messages = formatMatrixEvents([
      message('workflow', '正在执行', 100, { 'agentteams.workflow': workflow }),
    ], '@human:example.test');

    expect(messages[0].workflow).toEqual(workflow);
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
