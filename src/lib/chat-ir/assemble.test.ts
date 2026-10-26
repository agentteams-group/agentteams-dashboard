import { describe, expect, it } from 'vitest';
import { formatMatrixEvents } from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import { assembleChatTimeline, NO_ANSWER_STALE_MS } from './assemble';

const ME = '@me:server';
const BASE_TS = 1_700_000_000_000;

function ev(
  id: string,
  sender: string,
  body: string,
  tsDelta: number,
  contentExtra: Record<string, unknown> = {},
): MatrixEvent {
  return {
    event_id: id,
    sender,
    type: 'm.room.message',
    origin_server_ts: BASE_TS + tsDelta,
    content: { msgtype: 'm.text', body, ...contentExtra },
  } as MatrixEvent;
}

function notice(
  id: string,
  sender: string,
  body: string,
  tsDelta: number,
  extra: Record<string, unknown> = {},
) {
  return ev(id, sender, body, tsDelta, { msgtype: 'm.notice', ...extra });
}

function threadOf(rootId: string) {
  return { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } };
}

function replaceOf(rootId: string, newBody: string) {
  return {
    'm.relates_to': { rel_type: 'm.replace', event_id: rootId },
    'm.new_content': { msgtype: 'm.text', body: newBody },
  };
}

const COPAW_REASONING_REPR =
  "sequence_number=12 object='message' status='completed' error=None id='msg_aaa' " +
  "type='reasoning' role='assistant' " +
  "content=[TextContent(sequence_number=None, object='content', status=None, error=None, " +
  "type='text', index=0, delta=None, msg_id='msg_aaa', " +
  "text='先分析需求，再给出方案。')] code=None message=None usage=None metadata={}";

function assemble(
  events: MatrixEvent[],
  runtime: string,
  sender = '@w:server',
  now = BASE_TS + 10_000,
) {
  return assembleChatTimeline(formatMatrixEvents(events, ME), events, {
    currentUserId: ME,
    runtimeMap: { [sender]: { runtime, workerName: 'w' } },
    now,
  });
}

describe('ChatIR turn assembly', () => {
  it('assembles a qwenpaw turn: root edit is the answer, thread steps are process', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      notice('think', '@w:server', 'Thinking:\n\n先拆解需求', 1_000, threadOf('root')),
      ev('tool', '@w:server', '🔧 **execute_shell_command**\n```json\n{"command":"ls"}\n```', 2_000, threadOf('root')),
      ev('answer', '@w:server', '* 最终答案', 3_000, replaceOf('root', '最终答案：已完成')),
    ];

    const { messages, latestEventId } = assemble(events, 'qwenpaw');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'root',
      canonicalEventId: 'root',
      latestEventId: 'answer',
      turnState: 'finalized',
      content: '最终答案：已完成',
    });
    expect(messages[0].precomputedBlocks?.map((block) => block.type)).toEqual([
      'thinking',
      'tool_call',
      'text',
    ]);
    expect(messages[0].precomputedBlocks?.[2]).toMatchObject({ text: '最终答案：已完成' });
    expect(latestEventId).toBe('answer');
  });

  it('keeps qwenpaw thread narration inside the process fold', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      ev('say', '@w:server', '先分析一下仓库结构', 1_000, threadOf('root')),
      ev('answer', '@w:server', '* 答案', 2_000, replaceOf('root', '答案在这里')),
    ];

    const { messages } = assemble(events, 'qwenpaw');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('答案在这里');
    expect(messages[0].precomputedBlocks?.[0]).toMatchObject({
      type: 'text',
      inProcess: true,
      text: '先分析一下仓库结构',
    });
  });

  it('marks a qwenpaw run without a final edit as interrupted once stale', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      notice('think', '@w:server', '还在处理', 1_000, threadOf('root')),
    ];

    const pending = assemble(events, 'qwenpaw', '@w:server', BASE_TS + 1_000);
    const interrupted = assemble(events, 'qwenpaw', '@w:server', BASE_TS + NO_ANSWER_STALE_MS + 2_000);

    expect(pending.messages[0]).toMatchObject({ turnState: 'pending', content: '' });
    expect(interrupted.messages[0]).toMatchObject({ turnState: 'interrupted', content: '' });
  });

  it('folds hermes top-level process notices and keeps the last text as the answer', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      notice('think', '@w:server', '先分析需求', 1_000),
      ev('answer', '@w:server', '最终答复', 2_000),
    ];

    const { messages } = assemble(events, 'hermes');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ turnState: 'finalized', content: '最终答复' });
    expect(messages[0].precomputedBlocks?.map((block) => block.type)).toEqual(['thinking', 'text']);
  });

  it('does not merge adjacent hermes runs across a human message', () => {
    const events = [
      notice('root-1', '@w:server', '处理中...', 0),
      ev('answer-1', '@w:server', '第一轮', 1_000),
      ev('human', ME, '继续', 2_000),
      notice('root-2', '@w:server', '处理中...', 3_000),
      ev('answer-2', '@w:server', '第二轮', 4_000),
    ];

    const { messages } = assemble(events, 'hermes');

    expect(messages.map((message) => message.id)).toEqual([
      'root-1',
      'human',
      'root-2',
    ]);
    expect(messages[0].content).toBe('第一轮');
    expect(messages[2].content).toBe('第二轮');
  });

  it('tracks an openclaw streaming revision until the live marker disappears', () => {
    const streaming = assemble([
      ev('oc', '@w:server', '正在生成', 0, { 'org.matrix.msc4357.live': {} }),
    ], 'openclaw', '@w:server', BASE_TS + 1_000);

    const finalized = assemble([
      ev('oc', '@w:server', '正在生成', 0),
      ev('oc-final', '@w:server', '* 完成', 1_000, replaceOf('oc', '完成')),
    ], 'openclaw');

    expect(streaming.messages[0]).toMatchObject({
      turnState: 'running',
      isStreaming: true,
      content: '正在生成',
    });
    expect(finalized.messages[0]).toMatchObject({
      turnState: 'finalized',
      isStreaming: false,
      content: '完成',
      latestEventId: 'oc-final',
    });
  });

  it('keeps openclaw turns separate instead of merging by proximity', () => {
    const events = [
      ev('oc-1', '@w:server', '* 第一轮', 0, replaceOf('oc-1', '第一轮')),
      ev('oc-2', '@w:server', '* 第二轮', 20_000, replaceOf('oc-2', '第二轮')),
    ];

    const { messages } = assemble(events, 'openclaw');

    expect(messages.map((message) => [message.id, message.content])).toEqual([
      ['oc-1', '第一轮'],
      ['oc-2', '第二轮'],
    ]);
  });

  it('treats copaw repr dumps as process and a later text as the answer', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      ev('reason', '@w:server', COPAW_REASONING_REPR, 1_000),
      ev('answer', '@w:server', '* 最终答复', 2_000, replaceOf('root', '最终答复')),
    ];

    const { messages } = assemble(events, 'copaw');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ turnState: 'finalized', content: '最终答复' });
    // The reasoning repr folds as a thinking step, never as the answer.
    expect(messages[0].precomputedBlocks?.map((block) => block.type)).toEqual([
      'thinking',
      'text',
    ]);
    expect(messages[0].precomputedBlocks?.[0]).toMatchObject({
      type: 'thinking',
      content: '先分析需求，再给出方案。',
    });
  });

  it('does not fold manager messages (flat conversation)', () => {
    const events = [
      ev('m-1', '@mgr:server', '第一条', 0),
      ev('m-2', '@mgr:server', '第二条', 1_000),
    ];

    const { messages } = assemble(events, 'manager', '@mgr:server');

    expect(messages.map((message) => message.id)).toEqual(['m-1', 'm-2']);
    expect(messages.every((message) => message.turnState === 'finalized')).toBe(true);
  });

  it('keeps thread replies with a missing root as a detached turn', () => {
    const events = [
      ev('r-1', '@w:server', '第一段答案', 0, threadOf('missing-root')),
      ev('r-2', '@w:server', '第二段答案', 1_000, threadOf('missing-root')),
    ];

    const { messages, turns } = assemble(events, 'qwenpaw');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'missing-root',
      detached: true,
      turnState: 'detached',
      content: '第一段答案\n\n第二段答案',
    });
    expect(turns[0]).toMatchObject({ turnId: 'missing-root', detached: true });
  });

  it('is invariant to raw event arrival order', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      notice('think', '@w:server', 'Thinking:\n\n先拆解需求', 1_000, threadOf('root')),
      ev('tool', '@w:server', '🔧 **shell**\n```json\n{"command":"ls"}\n```', 2_000, threadOf('root')),
      ev('answer', '@w:server', '* 最终答案', 3_000, replaceOf('root', '最终答案')),
    ];

    const forward = assemble(events, 'qwenpaw');
    const shuffled = assemble([...events].reverse(), 'qwenpaw');

    const snapshot = (result: ReturnType<typeof assemble>) => result.messages.map((message) => ({
      id: message.id,
      content: message.content,
      state: message.turnState,
      types: message.precomputedBlocks?.map((block) => block.type),
    }));
    expect(snapshot(shuffled)).toEqual(snapshot(forward));
  });

  it('attaches an attachment relation to its exact target step', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      notice('think', '@w:server', 'Thinking:\n\n先拆解需求', 1_000, threadOf('root')),
      ev('att', '@w:server', 'full-log.md', 1_500, {
        msgtype: 'm.file',
        url: 'mxc://server/att',
        info: { mimetype: 'text/markdown' },
        'm.relates_to': { rel_type: 'com.agentteams.attachment', event_id: 'think' },
      }),
      ev('answer', '@w:server', '* 最终答案', 2_000, replaceOf('root', '最终答案')),
    ];

    const { messages } = assemble(events, 'qwenpaw');

    expect(messages).toHaveLength(1);
    const types = messages[0].precomputedBlocks?.map((block) => block.type);
    expect(types).toEqual(['thinking', 'attachment', 'text']);
    expect(messages[0].precomputedBlocks?.[1].payload).toMatchObject({
      filename: 'full-log.md',
      url: 'mxc://server/att',
    });
  });

  it('keeps an attachment whose target is missing as its own tile', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      ev('att', '@w:server', 'orphan.md', 1_000, {
        msgtype: 'm.file',
        url: 'mxc://server/orphan',
        'm.relates_to': { rel_type: 'com.agentteams.attachment', event_id: 'missing' },
      }),
    ];

    const { messages } = assemble(events, 'qwenpaw');

    expect(messages).toHaveLength(2);
    expect(messages[1].precomputedBlocks?.[0]).toMatchObject({ type: 'attachment' });
  });

  it('exposes latest raw and latest top-level receipt targets', () => {
    const events = [
      ev('top-1', '@human:server', '问题一', 0),
      ev('top-2', '@human:server', '问题二', 1_000),
      ev('reply', '@human:server', '话题回复', 2_000, threadOf('top-1')),
    ];

    const result = assemble(events, 'qwenpaw');

    expect(result.latestEventId).toBe('reply');
    expect(result.latestTopLevelEventId).toBe('top-2');
  });

  it('records every thread participant for topic filtering', () => {
    const events = [
      ev('root', '@w:server', '原始问题', 0),
      ev('worker-reply', '@w:server', '补充', 1_000, threadOf('root')),
      ev('human-reply', '@human:server', '追问', 2_000, threadOf('root')),
    ];

    const result = assemble(events, 'qwenpaw');

    expect(new Set(result.threadParticipants.root)).toEqual(
      new Set(['@w:server', '@human:server']),
    );
  });

  it('keeps one qwenpaw run together across its own file uploads', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      ev('think', '@w:server', '先做研究', 1_000, threadOf('root')),
      ev('announce', '@w:server', '[File: /workspace/deliverable.html]', 2_000, threadOf('root')),
      ev('file', '@w:server', 'deliverable.html', 2_010, {
        msgtype: 'm.file',
        url: 'mxc://server/opaqueId',
        info: { mimetype: 'text/html' },
      }),
      ev('more', '@w:server', '文件已发送，整理结论', 3_000, threadOf('root')),
      ev('answer', '@w:server', '* 完成', 4_000, replaceOf('root', '交付完成：deliverable.html')),
    ];

    const { messages, turns } = assemble(events, 'qwenpaw');

    expect(messages.map((message) => message.id)).toEqual(['root', 'file']);
    expect(messages[0]).toMatchObject({ turnState: 'finalized', content: '交付完成：deliverable.html' });
    const text = messages[0].precomputedBlocks?.map((block) => block.text ?? '').join('\n') ?? '';
    expect(text).toContain('先做研究');
    expect(text).toContain('文件已发送');
    expect(turns).toHaveLength(1);
    expect(messages[1]).toMatchObject({ mediaUrl: 'mxc://server/opaqueId' });
  });

  it('associates an mxc image with the turn that names its filename', () => {
    const events = [
      notice('root', '@w:server', '处理中...', 0),
      ev('announce', '@w:server', '[Image: /workspace/report-2026.png]', 500, threadOf('root')),
      ev('answer', '@w:server', '* 结果', 1_000, replaceOf('root', '报告见 report-2026.png')),
      ev('media', '@w:server', 'report-2026.png', 1_100, {
        msgtype: 'm.image',
        url: 'mxc://server/opaqueMediaId',
        info: { mimetype: 'image/png' },
      }),
    ];

    const { messages } = assemble(events, 'qwenpaw');

    // The media keeps its own tile so its msgtype can render the preview, but
    // the turn records it as a source event (receipts / divider matching).
    expect(messages.map((message) => message.id)).toEqual(['root', 'media']);
    expect(messages[0].sourceEventIds).toContain('media');
    expect(messages[1]).toMatchObject({
      id: 'media',
      mediaUrl: 'mxc://server/opaqueMediaId',
    });
    expect(messages[0].mediaUrl).toBeUndefined();
  });

  it('does not associate ambiguous top-level media', () => {
    const events = [
      notice('root-1', '@w:server', '处理中...', 0),
      ev('answer-1', '@w:server', '* 结果', 1_000, replaceOf('root-1', '见 shared.pdf')),
      notice('root-2', '@w:server', '处理中...', 2_000),
      ev('answer-2', '@w:server', '* 结果', 3_000, replaceOf('root-2', '再看 shared.pdf')),
      ev('media', '@w:server', 'shared.pdf', 4_000, {
        msgtype: 'm.file',
        url: 'mxc://server/shared',
      }),
    ];

    const { messages } = assemble(events, 'qwenpaw');

    expect(messages.map((message) => message.id)).toEqual(['root-1', 'root-2', 'media']);
    expect(messages[2].mediaUrl).toBe('mxc://server/shared');
    expect(messages[0].sourceEventIds).not.toContain('media');
    expect(messages[1].sourceEventIds).not.toContain('media');
  });
});
