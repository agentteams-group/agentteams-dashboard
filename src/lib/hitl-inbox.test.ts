import { beforeEach, describe, expect, it } from 'vitest';
import type { MatrixEvent } from '@/lib/matrix-api';
import {
  extractConfirmationFromEvent,
  ingestHitlTimelineEvents,
  isHitlResolutionReply,
  selectConfirmationList,
  useHitlInboxStore,
} from '@/lib/hitl-inbox';

const TOOL_GUARD_BODY = `⏳ Waiting for approval / 等待审批

Tool / 工具: execute_shell_command
Triggered by / 触发来源: Tool Guard / 工具护栏
Parameters / 参数:
{ "command": "ls" }

💡 Triggered by tool guardrails
Type /approve to approve, or send any message to deny.`;

function msg(
  eventId: string,
  sender: string,
  ts: number,
  extra: Record<string, unknown> = {},
): MatrixEvent {
  return {
    event_id: eventId,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: '', ...extra },
  };
}

describe('isHitlResolutionReply', () => {
  it('recognises /approve and 拒绝', () => {
    expect(isHitlResolutionReply('/approve')).toBe(true);
    expect(isHitlResolutionReply('  拒绝  ')).toBe(true);
    expect(isHitlResolutionReply('ok')).toBe(false);
  });
});

describe('extractConfirmationFromEvent', () => {
  it('extracts a Tool Guard confirmation prompt', () => {
    const event = msg('$c1', '@agent:test', 1000, { body: TOOL_GUARD_BODY });
    const item = extractConfirmationFromEvent(event, '!room:test');
    expect(item).toEqual(
      expect.objectContaining({
        id: '!room:test:$c1',
        roomId: '!room:test',
        eventId: '$c1',
        toolName: 'execute_shell_command',
        triggeredBy: 'Tool Guard / 工具护栏',
        approveReply: '/approve',
        rejectReply: '拒绝',
      }),
    );
  });

  it('extracts a v1 org.agentteams.run confirmation by confirmation_id', () => {
    const event = msg('$c2', '@agent:test', 2000, {
      body: 'irrelevant',
      'org.agentteams.run': {
        version: '1',
        blocks: [
          {
            type: 'confirmation',
            tool_name: 'write_file',
            confirmation_id: 'conf-9',
            parameters: '{ "path": "/tmp/a" }',
          },
        ],
      },
    });
    const item = extractConfirmationFromEvent(event, '!room:test');
    expect(item).toEqual(
      expect.objectContaining({
        id: 'conf-9',
        toolName: 'write_file',
        parameters: '{ "path": "/tmp/a" }',
      }),
    );
  });

  it('reads confirmation content from m.replace new_content', () => {
    const event = msg('$edit', '@agent:test', 3000, {
      body: '* fallback',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
      'm.new_content': { msgtype: 'm.text', body: TOOL_GUARD_BODY },
    });
    const item = extractConfirmationFromEvent(event, '!room:test');
    expect(item?.eventId).toBe('$root');
    expect(item?.id).toBe('!room:test:$root');
    expect(item?.toolName).toBe('execute_shell_command');
  });

  it('returns null for ordinary messages', () => {
    const event = msg('$n', '@agent:test', 1000, { body: 'hello' });
    expect(extractConfirmationFromEvent(event, '!room:test')).toBeNull();
  });
});

describe('useHitlInboxStore', () => {
  beforeEach(() => {
    useHitlInboxStore.setState({
      confirmations: {},
      pendingChatRoomId: null,
      pendingProjectKey: null,
    });
  });

  it('upserts, lists newest first, and drops by event id', () => {
    const older = extractConfirmationFromEvent(
      msg('$a', '@agent:test', 1000, { body: TOOL_GUARD_BODY }),
      '!r1',
    )!;
    const newer = extractConfirmationFromEvent(
      msg('$b', '@agent:test', 2000, {
        body: TOOL_GUARD_BODY.replace('execute_shell_command', 'write_file'),
      }),
      '!r1',
    )!;
    useHitlInboxStore.getState().upsertConfirmation(older);
    useHitlInboxStore.getState().upsertConfirmation(newer);
    expect(selectConfirmationList(useHitlInboxStore.getState().confirmations).map((c) => c.eventId)).toEqual([
      '$b',
      '$a',
    ]);
    useHitlInboxStore.getState().dropByEventId('!r1', '$a');
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toHaveLength(1);
  });

  it('resolves the oldest pending confirmation in a room on /approve', () => {
    ingestHitlTimelineEvents(
      '!r1',
      [
        msg('$c1', '@agent:test', 1000, { body: TOOL_GUARD_BODY }),
        msg('$c2', '@agent:test', 2000, {
          body: TOOL_GUARD_BODY.replace('execute_shell_command', 'write_file'),
        }),
      ],
      '@user:test',
    );
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toHaveLength(2);
    ingestHitlTimelineEvents(
      '!r1',
      [msg('$reply', '@user:test', 3000, { body: '/approve' })],
      '@user:test',
    );
    const remaining = selectConfirmationList(useHitlInboxStore.getState().confirmations);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].eventId).toBe('$c2');
  });

  it('drops a confirmation when m.replace replaces it with non-confirmation content', () => {
    ingestHitlTimelineEvents(
      '!r1',
      [msg('$root', '@agent:test', 1000, { body: TOOL_GUARD_BODY })],
      '@user:test',
    );
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toHaveLength(1);
    ingestHitlTimelineEvents(
      '!r1',
      [
        msg('$edit', '@agent:test', 2000, {
          body: '* done',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
          'm.new_content': { msgtype: 'm.text', body: '已完成' },
        }),
      ],
      '@user:test',
    );
    expect(useHitlInboxStore.getState().confirmations).toEqual({});
  });

  it('ingests historical chunks newest-first without missing a later /approve', () => {
    ingestHitlTimelineEvents(
      '!r1',
      [
        msg('$reply', '@user:test', 2000, { body: '/approve' }),
        msg('$c1', '@agent:test', 1000, { body: TOOL_GUARD_BODY }),
      ],
      '@user:test',
    );
    expect(useHitlInboxStore.getState().confirmations).toEqual({});
  });
});
