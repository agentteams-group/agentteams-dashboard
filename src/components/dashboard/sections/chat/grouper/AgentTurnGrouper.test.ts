import { describe, expect, it } from 'vitest';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { coalesceWorkerTurns } from './AgentTurnGrouper';

function workerMessage(overrides: Partial<DisplayMessage> & Pick<DisplayMessage, 'id' | 'content' | 'timestamp'>): DisplayMessage {
  return {
    sender: '@ceshi:example.test',
    senderShort: 'ceshi',
    type: 'm.text',
    isMe: false,
    workerName: 'ceshi',
    runtime: 'qwenpaw',
    rawContent: { msgtype: 'm.text' },
    eventId: overrides.id,
    ...overrides,
  };
}

function notice(id: string, content: string, timestamp: number, threadId?: string): DisplayMessage {
  return workerMessage({
    id,
    content,
    timestamp,
    type: 'm.notice',
    rawContent: { msgtype: 'm.notice' },
    threadId,
    isThreadReply: Boolean(threadId),
  });
}

describe('coalesceWorkerTurns', () => {
  it('folds a QwenPaw step stream into one message with a single process run', () => {
    const messages: DisplayMessage[] = [
      notice('root', '处理中...', 1_000),
      notice('thinking', 'Let me check the renderer.', 2_000, 'root'),
      workerMessage({
        id: 'tool',
        content: '🔧 **execute_shell_command**\n```\n{"command":"ls"}\n```',
        timestamp: 3_000,
        threadId: 'root',
        isThreadReply: true,
      }),
      workerMessage({ id: 'answer', content: '全部对上了。', timestamp: 4_000, threadId: 'root', isThreadReply: true }),
      workerMessage({
        id: 'file',
        content: '[File: file:///tmp/musk_plane.html]',
        timestamp: 5_000,
        threadId: 'root',
        isThreadReply: true,
      }),
    ];

    const turns = coalesceWorkerTurns(messages);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: 'root',
      workerName: 'ceshi',
      timestamp: 5_000,
      content: '全部对上了。\n\n[File: file:///tmp/musk_plane.html]',
    });
    expect(turns[0].sourceEventIds).toEqual(['root', 'thinking', 'tool', 'answer', 'file']);
    expect(turns[0].precomputedBlocks?.map((block) => block.type)).toEqual([
      'thinking',
      'tool_call',
      'text',
    ]);
    // All streamed output collapses into one continuous answer bubble.
    expect(turns[0].precomputedBlocks?.[2].text).toBe(
      '全部对上了。\n\n[File: file:///tmp/musk_plane.html]',
    );
    // The run placeholder never becomes an output bubble.
    expect(turns[0].precomputedBlocks?.some((block) => block.text === '处理中...')).toBe(false);
  });

  it('folds a placeholder whose final edit sorts after its thread steps', () => {
    // QwenPaw edits the root placeholder with the finished answer, so the root
    // lands after the thread replies it opened. The turn must still be one run
    // anchored on the root event.
    const messages: DisplayMessage[] = [
      notice('thinking', '先看渲染入口', 2_000, 'root'),
      workerMessage({
        id: 'tool',
        content: '🔧 **execute_shell_command**\n```\n{"command":"ls"}\n```',
        timestamp: 3_000,
        threadId: 'root',
        isThreadReply: true,
      }),
      workerMessage({
        id: 'root',
        content: '最终答案',
        timestamp: 4_000,
        revisionCount: 1,
      }),
    ];

    const turns = coalesceWorkerTurns(messages);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ id: 'root', eventId: 'root', content: '最终答案' });
    expect(turns[0].sourceEventIds).toEqual(['thinking', 'tool', 'root']);
    expect(turns[0].precomputedBlocks?.map((block) => block.type)).toEqual([
      'thinking',
      'tool_call',
      'text',
    ]);
  });

  it('keeps a non-worker message between turns as its own tile', () => {
    const human: DisplayMessage = {
      id: 'human',
      sender: '@admin:example.test',
      senderShort: 'admin',
      content: '继续',
      timestamp: 3_500,
      type: 'm.text',
      isMe: false,
      rawContent: { msgtype: 'm.text' },
      eventId: 'human',
    };
    const messages: DisplayMessage[] = [
      notice('root-1', '处理中...', 1_000),
      notice('thinking-1', '第一步', 2_000, 'root-1'),
      human,
      notice('root-2', '处理中...', 4_000),
      notice('thinking-2', '第二步', 5_000, 'root-2'),
    ];

    const turns = coalesceWorkerTurns(messages);

    expect(turns.map((turn) => turn.id)).toEqual(['root-1', 'human', 'root-2']);
    expect(turns[0].sourceEventIds).toEqual(['root-1', 'thinking-1']);
    expect(turns[2].sourceEventIds).toEqual(['root-2', 'thinking-2']);
  });

  it('does not fold interactive confirmations into the turn', () => {
    const confirmation = workerMessage({
      id: 'confirm',
      content: 'Waiting for approval / 等待审批\nTool / 工具: run_shell\nType /approve to approve, or send any message to deny.',
      timestamp: 2_500,
    });
    const messages: DisplayMessage[] = [
      notice('root', '处理中...', 1_000),
      notice('thinking', '准备执行', 2_000, 'root'),
      confirmation,
      notice('thinking-2', '继续执行', 3_000, 'root'),
    ];

    const turns = coalesceWorkerTurns(messages);

    expect(turns.map((turn) => turn.id)).toEqual(['root', 'confirm', 'thinking-2']);
  });

  it('leaves a text-only agent sequence as individual bubbles', () => {
    const messages: DisplayMessage[] = [
      workerMessage({ id: 'first', content: '第一段', timestamp: 1_000 }),
      workerMessage({ id: 'second', content: '第二段', timestamp: 2_000 }),
    ];

    const turns = coalesceWorkerTurns(messages);

    expect(turns.map((turn) => turn.id)).toEqual(['first', 'second']);
  });

  it('splits a turn when the next step arrives after a long quiet period', () => {
    const messages: DisplayMessage[] = [
      notice('root-1', '处理中...', 1_000),
      notice('thinking-1', '第一步', 2_000, 'root-1'),
      notice('root-2', '处理中...', 11 * 60 * 1000),
      notice('thinking-2', '第二步', 11 * 60 * 1000 + 1_000, 'root-2'),
    ];

    const turns = coalesceWorkerTurns(messages);

    expect(turns.map((turn) => turn.id)).toEqual(['root-1', 'root-2']);
  });
});
