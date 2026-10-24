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

function interventionMsg(
  eventId: string,
  sender: string,
  ts: number,
  confirmationId: string,
  question = '请选择页面类型',
): MatrixEvent {
  return msg(eventId, sender, ts, {
    body: question,
    'org.agentteams.run': {
      version: '1',
      blocks: [
        {
          type: 'confirmation',
          tool_name: 'ask_human',
          confirmation_id: confirmationId,
          question,
          options: [{ id: 'landing', label: '落地页' }],
        },
      ],
    },
  });
}

describe('isHitlResolutionReply', () => {
  it('recognises /approve and 拒绝', () => {
    expect(isHitlResolutionReply('/approve')).toBe(true);
    expect(isHitlResolutionReply('  拒绝  ')).toBe(true);
    expect(isHitlResolutionReply('ok')).toBe(false);
  });

  it('recognises multilingual approve/deny keywords case-insensitively (FUNC-07)', () => {
    expect(isHitlResolutionReply('Approve')).toBe(true);
    expect(isHitlResolutionReply('DENY')).toBe(true);
    expect(isHitlResolutionReply(' reject ')).toBe(true);
    expect(isHitlResolutionReply('同意')).toBe(true);
    expect(isHitlResolutionReply('批准')).toBe(true);
    expect(isHitlResolutionReply('驳回')).toBe(true);
    expect(isHitlResolutionReply('/reject')).toBe(true);
    // Non-exact phrases must not resolve.
    expect(isHitlResolutionReply('I approve this')).toBe(false);
    expect(isHitlResolutionReply('拒绝执行')).toBe(false);
    expect(isHitlResolutionReply('')).toBe(false);
  });

  it('recognises intervention answers beginning with the reply marker', () => {
    expect(isHitlResolutionReply('【干预答复】\nA1：按模块')).toBe(true);
    expect(isHitlResolutionReply('  【干预答复】\nA1：自定义')).toBe(true);
    expect(isHitlResolutionReply('答复：【干预答复】\nA1：按模块')).toBe(false);
  });

  it('ignores the @mention prefix added in worker/team rooms', () => {
    expect(isHitlResolutionReply('@worker:matrix-local.agentteams.io:18080 【干预答复】\nA1：按模块')).toBe(true);
    expect(isHitlResolutionReply('@worker /approve')).toBe(true);
    expect(isHitlResolutionReply('@质检员:test 拒绝')).toBe(true);
    expect(isHitlResolutionReply('@worker 请批准这个方案')).toBe(false);
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
      resolutions: {},
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

  it('resolves a pending confirmation from a cross-client intervention reply', () => {
    ingestHitlTimelineEvents(
      '!r1',
      [interventionMsg('$q1', '@agent:test', 1000, 'conf-1')],
      '@user:test',
    );
    const answer = '@agent:test 【干预答复】\nA1：按模块';
    ingestHitlTimelineEvents(
      '!r1',
      [msg('$reply', '@user:test', 2000, { body: answer })],
      '@user:test',
    );

    const state = useHitlInboxStore.getState();
    expect(state.confirmations).toEqual({});
    expect(state.resolutions['conf-1']).toEqual(
      expect.objectContaining({
        status: 'answered',
        actor: '@user:test',
        answer,
        timestamp: expect.any(Number),
      }),
    );
  });

  it('does not let an intervention answer resolve an older unrelated tool approval', () => {
    ingestHitlTimelineEvents(
      '!r1',
      [
        msg('$guard', '@agent:test', 1000, { body: TOOL_GUARD_BODY }),
        interventionMsg('$q1', '@agent:test', 2000, 'conf-1'),
      ],
      '@user:test',
    );
    ingestHitlTimelineEvents(
      '!r1',
      [msg('$reply', '@user:test', 3000, { body: '@agent:test 【干预答复】\nA1：落地页' })],
      '@user:test',
    );

    const state = useHitlInboxStore.getState();
    expect(Object.keys(state.confirmations)).toEqual(['!r1:$guard']);
    expect(state.resolutions['conf-1']?.status).toBe('answered');
    expect(state.resolutions['!r1:$guard']).toBeUndefined();
  });

  it('uses the m.reference relation to resolve the exact card among several pending', () => {
    ingestHitlTimelineEvents(
      '!r1',
      [
        interventionMsg('$q1', '@agent:test', 1000, 'conf-1', '第一问'),
        interventionMsg('$q2', '@agent:test', 2000, 'conf-2', '第二问'),
      ],
      '@user:test',
    );
    ingestHitlTimelineEvents(
      '!r1',
      [
        msg('$reply', '@user:test', 3000, {
          body: '【干预答复】\nA1：落地页',
          'm.relates_to': { rel_type: 'm.reference', event_id: '$q2' },
        }),
      ],
      '@user:test',
    );

    const state = useHitlInboxStore.getState();
    expect(Object.keys(state.confirmations)).toEqual(['conf-1']);
    expect(state.resolutions['conf-2']?.status).toBe('answered');
    expect(state.resolutions['conf-1']).toBeUndefined();
  });

  it('does not fall through to another card when the referenced card was already resolved locally', () => {
    ingestHitlTimelineEvents(
      '!r1',
      [
        interventionMsg('$q1', '@agent:test', 1000, 'conf-1', '第一问'),
        interventionMsg('$q2', '@agent:test', 2000, 'conf-2', '第二问'),
      ],
      '@user:test',
    );
    useHitlInboxStore.getState().resolveConfirmation('conf-2', '@user:test', '本地已答');
    ingestHitlTimelineEvents(
      '!r1',
      [
        msg('$reply', '@user:test', 3000, {
          body: '【干预答复】\nA1：落地页',
          'm.relates_to': { rel_type: 'm.reference', event_id: '$q2' },
        }),
      ],
      '@user:test',
    );

    const state = useHitlInboxStore.getState();
    expect(Object.keys(state.confirmations)).toEqual(['conf-1']);
    expect(state.resolutions['conf-1']).toBeUndefined();
  });

  it('uses the m.in_reply_to relation for a manual reply to a specific card', () => {
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
    ingestHitlTimelineEvents(
      '!r1',
      [
        msg('$reply', '@user:test', 3000, {
          body: '/approve',
          'm.relates_to': { 'm.in_reply_to': { event_id: '$c2' } },
        }),
      ],
      '@user:test',
    );

    const remaining = Object.keys(useHitlInboxStore.getState().confirmations);
    expect(remaining).toEqual(['!r1:$c1']);
  });

  it('does not resurrect a resolved request when its old event is reingested', () => {
    const request = msg('$c1', '@agent:test', 1000, { body: TOOL_GUARD_BODY });
    ingestHitlTimelineEvents('!r1', [request], '@user:test');
    ingestHitlTimelineEvents(
      '!r1',
      [msg('$reply', '@user:test', 2000, { body: '/approve' })],
      '@user:test',
    );
    ingestHitlTimelineEvents('!r1', [request], '@user:test');

    const state = useHitlInboxStore.getState();
    expect(state.confirmations).toEqual({});
    expect(state.resolutions['!r1:$c1']?.status).toBe('answered');
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
