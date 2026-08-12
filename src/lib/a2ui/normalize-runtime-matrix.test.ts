/**
 * AC-C8 / AC-Q4: 5 runtimes × 7 canonical event sequences.
 *
 * Every sequence runs through the real pipeline — formatMatrixEvents
 * (m.replace / m.thread merge) → normalizeToBlocks — with the runtime
 * resolved exactly like ChatRoom does (sender MXID → worker runtime).
 * Snapshots pin the block structure per runtime; targeted assertions pin
 * the semantics that must not regress (error kinds, confidence, hints).
 */
import { describe, expect, it } from 'vitest';
import { formatMatrixEvents } from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import { normalizeToBlocks } from './normalize';
import type { WorkerRuntime } from '@/lib/agentteams-api';

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

function notice(id: string, sender: string, body: string, tsDelta: number, extra: Record<string, unknown> = {}) {
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

const COPAW_TOOL_CALL_REPR =
  "sequence_number=13 object='message' status='completed' error=None id='msg_bbb' " +
  "type='function_call' role='assistant' " +
  "content=[DataContent(sequence_number=None, object='content', status=None, error=None, " +
  "type='data', index=0, delta=None, msg_id='msg_bbb', " +
  "data={'call_id': 'call_1', 'name': 'read_file', 'arguments': '{\"path\": \"~/SOUL.md\"}'})] " +
  'code=None message=None usage=None metadata={}';

const WORKFLOW_PAYLOAD = {
  type: 'agentteams.workflow',
  runId: 'run-1',
  status: 'running',
  title: '发布流程',
  subagents: [{ name: 'worker-a', status: 'running' }],
  steps: [{ title: '规划', status: 'completed' }],
};

const LONG_MESSAGE = {
  version: 1,
  url: 'mxc://server/media-id',
  filename: 'full-reply.txt',
  mimetype: 'text/plain',
};

/** The 7 canonical sequence kinds, parameterized per runtime. */
function sequencesFor(runtime: WorkerRuntime, sender: string): Record<string, MatrixEvent[]> {
  const root = `$${runtime}-root`;
  const placeholder = notice(root, sender, '处理中...', 0);
  return {
    placeholder:
      runtime === 'hermes'
        ? // hermes has no placeholder; the upstream streaming draft is a plain text event
          [ev(`$${runtime}-draft`, sender, '正在生成', 0)]
        : [placeholder],
    thinking: {
      qwenpaw: [placeholder, notice(`$${runtime}-think`, sender, 'Thinking:\n\n先拆解需求', 1, threadOf(root))],
      copaw: [ev(`$${runtime}-think`, sender, COPAW_REASONING_REPR, 0)],
      hermes: [notice(`$${runtime}-think`, sender, '正在整理思路，然后给出结论', 0)],
      openclaw: [ev(`$${runtime}-think`, sender, '<details class="thinking">先分析再回答</details>', 0)],
      openhuman: [notice(`$${runtime}-think`, sender, '整理一下上下文', 0)],
    }[runtime],
    tool_call: {
      qwenpaw: [placeholder, notice(`$${runtime}-tool`, sender, 'tool: web_search', 1, threadOf(root))],
      copaw: [ev(`$${runtime}-tool`, sender, COPAW_TOOL_CALL_REPR, 0)],
      hermes: [ev(`$${runtime}-tool`, sender, '🔧 **web_search**\n```json\n{"query":"发布状态"}\n```', 0)],
      openclaw: [ev(`$${runtime}-tool`, sender, '```card\n{"type":"tool_call","tool_name":"read_file","status":"success"}\n```', 0)],
      openhuman: [notice(`$${runtime}-tool`, sender, 'calling list_directory', 0)],
    }[runtime],
    final: [placeholder, ev(`$${runtime}-final`, sender, '* 最终答案', 2, replaceOf(root, '最终答案：已完成'))],
    error: {
      qwenpaw: [placeholder, ev(`$${runtime}-end`, sender, '* 已处理', 2, replaceOf(root, '已处理'))],
      copaw: [placeholder, ev(`$${runtime}-end`, sender, '* 处理异常', 2, replaceOf(root, '处理异常'))],
      hermes: [placeholder, ev(`$${runtime}-end`, sender, '* 已取消', 2, replaceOf(root, '已取消'))],
      openclaw: [placeholder, ev(`$${runtime}-end`, sender, '* 已取消', 2, replaceOf(root, '已取消'))],
      openhuman: [placeholder, ev(`$${runtime}-end`, sender, '* 处理异常', 2, replaceOf(root, '处理异常'))],
    }[runtime],
    long_message: [
      ev(`$${runtime}-long`, sender, '正文被截断…', 0, { 'com.agentteams.long_message': LONG_MESSAGE }),
    ],
    workflow: [
      notice(`$${runtime}-wf`, sender, '工作流启动', 0, { 'agentteams.workflow': WORKFLOW_PAYLOAD }),
    ],
  };
}

const RUNTIMES: WorkerRuntime[] = ['openclaw', 'copaw', 'hermes', 'openhuman', 'qwenpaw'];

function runSequence(events: MatrixEvent[], runtime: WorkerRuntime) {
  const messages = formatMatrixEvents(events, ME);
  return messages.map((message) => ({
    sender: message.sender,
    msgType: message.type,
    isEdited: message.isEdited ?? false,
    revisionCount: message.revisionCount ?? 0,
    blocks: normalizeToBlocks({
      body: message.content,
      formattedBody: message.formattedContent,
      content: message.rawContent ?? {},
      isStreaming: !!message.isStreaming,
      isMine: message.isMe,
      runtime,
    }),
  }));
}

describe('runtime × sequence matrix (AC-C8)', () => {
  for (const runtime of RUNTIMES) {
    const sender = `@w-${runtime}:server`;
    const sequences = sequencesFor(runtime, sender);
    for (const [kind, events] of Object.entries(sequences)) {
      it(`${runtime} / ${kind}`, () => {
        expect(runSequence(events, runtime)).toMatchSnapshot();
      });
    }
  }
});

describe('runtime matrix semantics', () => {
  it('attributes every produced block to the owning runtime', () => {
    const sender = '@w-qwenpaw:server';
    const placeholder = sequencesFor('qwenpaw', sender).placeholder;
    const thinking = sequencesFor('qwenpaw', sender).thinking;
    const output = runSequence([...placeholder, ...thinking.slice(1)], 'qwenpaw');
    for (const message of output) {
      for (const block of message.blocks) {
        expect(block.runtimeHint).toBe('qwenpaw');
      }
    }
  });

  it('leaves runtimeHint unset when the runtime is unknown', () => {
    const output = runSequence(
      [notice('$n1', '@stranger:server', '正在整理思路', 0)],
      // runtime unknown → cast through null
      null as unknown as WorkerRuntime,
    );
    expect(output[0].blocks[0].type).toBe('thinking');
    expect(output[0].blocks[0].runtimeHint).toBeUndefined();
  });

  it('qwenpaw thinking thread child renders as a thinking block', () => {
    const sender = '@w-qwenpaw:server';
    const output = runSequence(sequencesFor('qwenpaw', sender).thinking, 'qwenpaw');
    const thinkingMessage = output.find((m) => m.blocks.some((b) => b.type === 'thinking'));
    expect(thinkingMessage).toBeDefined();
    expect(thinkingMessage?.blocks[0]).toMatchObject({ type: 'thinking', runtimeHint: 'qwenpaw' });
  });

  it('qwenpaw tool notice renders as a low-confidence tool_call pinned to qwenpaw', () => {
    const sender = '@w-qwenpaw:server';
    const output = runSequence(sequencesFor('qwenpaw', sender).tool_call, 'qwenpaw');
    const toolMessage = output.find((m) => m.blocks.some((b) => b.type === 'tool_call'));
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.blocks[0].payload).toMatchObject({
      tool_name: 'web_search',
      confidence: 'low',
    });
    expect(toolMessage?.blocks[0].runtimeHint).toBe('qwenpaw');
  });

  it('merges the m.replace final into the placeholder root and counts the revision', () => {
    const sender = '@w-copaw:server';
    const output = runSequence(sequencesFor('copaw', sender).final, 'copaw');
    expect(output).toHaveLength(1);
    expect(output[0].isEdited).toBe(true);
    expect(output[0].revisionCount).toBe(1);
    expect(output[0].blocks[0]).toMatchObject({ type: 'text', runtimeHint: 'copaw' });
  });

  it('maps run-ending sentinels to the three error block variants', () => {
    const cases: Array<[WorkerRuntime, string, string]> = [
      ['qwenpaw', 'quiet', '已处理（无回复）'],
      ['copaw', 'failed', '任务异常'],
      ['hermes', 'cancelled', '任务已取消'],
      ['openclaw', 'cancelled', '任务已取消'],
      ['openhuman', 'failed', '任务异常'],
    ];
    for (const [runtime, kind, title] of cases) {
      const sender = `@w-${runtime}:server`;
      const output = runSequence(sequencesFor(runtime, sender).error, runtime);
      const errorMessage = output.find((m) => m.blocks.some((b) => b.type === 'error'));
      expect(errorMessage, `${runtime} error sequence`).toBeDefined();
      expect(errorMessage?.blocks[0].payload).toMatchObject({ kind, title });
    }
  });

  it('copaw repr reasoning and tool calls keep their block types', () => {
    const sender = '@w-copaw:server';
    const thinking = runSequence(sequencesFor('copaw', sender).thinking, 'copaw');
    expect(thinking[0].blocks[0].type).toBe('thinking');
    const tool = runSequence(sequencesFor('copaw', sender).tool_call, 'copaw');
    expect(tool[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      payload: { tool_name: 'read_file' },
    });
  });

  it('long message metadata becomes an attachment block on every runtime', () => {
    for (const runtime of RUNTIMES) {
      const sender = `@w-${runtime}:server`;
      const output = runSequence(sequencesFor(runtime, sender).long_message, runtime);
      expect(output[0].blocks[0]).toMatchObject({
        type: 'attachment',
        payload: { url: 'mxc://server/media-id', filename: 'full-reply.txt' },
        runtimeHint: runtime,
      });
    }
  });

  it('workflow payloads render as workflow blocks on every runtime', () => {
    for (const runtime of RUNTIMES) {
      const sender = `@w-${runtime}:server`;
      const output = runSequence(sequencesFor(runtime, sender).workflow, runtime);
      expect(output[0].blocks[0].type).toBe('workflow');
    }
  });
});
