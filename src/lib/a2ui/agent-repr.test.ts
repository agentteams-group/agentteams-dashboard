import { describe, it, expect } from 'vitest';
import {
  parseAgentRepr,
  agentReprToBlocks,
  tryParseAgentReprBlocks,
} from '@/lib/a2ui/agent-repr';
import { parseA2uiContent } from '@/lib/a2ui/parser';

// The exact dump observed in the manager room (thread message body).
const ASSISTANT_MESSAGE_REPR =
  "sequence_number=88 object='message' status='completed' error=None " +
  "id='msg_3474e5b2-5d0f-4f3e-bea5-05997607507b' type='message' role='assistant' " +
  "content=[TextContent(sequence_number=None, object='content', status=None, error=None, " +
  "type='text', index=0, delta=None, msg_id='msg_3474e5b2-5d0f-4f3e-bea5-05997607507b', " +
  "text='好的！既然你让我自由发挥，那我就给自己定个实用的人设，有需要随时调整。'), " +
  "TextContent(sequence_number=None, object='content', status=None, error=None, " +
  "type='text', index=1, delta=None, msg_id='msg_3474e5b2-5d0f-4f3e-bea5-05997607507b', " +
  "text='')] code=None message=None usage=None metadata={}";

const REASONING_REPR =
  "sequence_number=12 object='message' status='completed' error=None id='msg_aaa' " +
  "type='reasoning' role='assistant' " +
  "content=[TextContent(sequence_number=None, object='content', status=None, error=None, " +
  "type='text', index=0, delta=None, msg_id='msg_aaa', " +
  "text='先分析需求，\\n再给出方案。')] code=None message=None usage=None metadata={}";

const TOOL_CALL_REPR =
  "sequence_number=13 object='message' status='completed' error=None id='msg_bbb' " +
  "type='function_call' role='assistant' " +
  "content=[DataContent(sequence_number=None, object='content', status=None, error=None, " +
  "type='data', index=0, delta=None, msg_id='msg_bbb', " +
  "data={'call_id': 'call_1', 'name': 'read_file', 'arguments': '{\"path\": \"~/SOUL.md\"}'})] " +
  'code=None message=None usage=None metadata={}';

const TOOL_CALL_STREAMING_REPR = TOOL_CALL_REPR.replace(
  "status='completed'",
  "status='in_progress'"
);

const TOOL_OUTPUT_REPR =
  "sequence_number=14 object='message' status='completed' error=None id='msg_ccc' " +
  "type='function_call_output' role='assistant' " +
  "content=[DataContent(sequence_number=None, object='content', status=None, error=None, " +
  "type='data', index=0, delta=None, msg_id='msg_ccc', " +
  "data={'call_id': 'call_1', 'name': 'read_file', 'output': '# SOUL\\n内容'})] " +
  'code=None message=None usage=None metadata={}';

describe('parseAgentRepr', () => {
  it('parses an assistant message repr', () => {
    const msg = parseAgentRepr(ASSISTANT_MESSAGE_REPR);
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('message');
    expect(msg?.status).toBe('completed');
    expect(msg?.role).toBe('assistant');
    expect(msg?.content).toHaveLength(2);
    expect(msg?.content[0].__class__).toBe('TextContent');
    expect(msg?.content[0].text).toBe(
      '好的！既然你让我自由发挥，那我就给自己定个实用的人设，有需要随时调整。'
    );
    expect(msg?.content[1].text).toBe('');
  });

  it('decodes escape sequences in strings', () => {
    const msg = parseAgentRepr(REASONING_REPR);
    expect(msg?.content[0].text).toBe('先分析需求，\n再给出方案。');
  });

  it('parses nested data dicts', () => {
    const msg = parseAgentRepr(TOOL_CALL_REPR);
    const data = msg?.content[0].data as Record<string, unknown>;
    expect(data.name).toBe('read_file');
    expect(data.arguments).toBe('{"path": "~/SOUL.md"}');
  });

  it('returns null for normal chat text', () => {
    expect(parseAgentRepr('你好，汇报运行情况')).toBeNull();
    expect(parseAgentRepr('📖 read_file: "~/.hermes/SOUL.md"')).toBeNull();
  });

  it('returns null for truncated/invalid reprs', () => {
    expect(parseAgentRepr("sequence_number=88 object='message' content=[TextContent(")).toBeNull();
  });
});

describe('agentReprToBlocks', () => {
  it('maps assistant text parts to a single text block, dropping empties', () => {
    const msg = parseAgentRepr(ASSISTANT_MESSAGE_REPR)!;
    const { blocks, hasThinking, hasToolCall } = agentReprToBlocks(msg);
    expect(blocks).toEqual([
      {
        type: 'text',
        text: '好的！既然你让我自由发挥，那我就给自己定个实用的人设，有需要随时调整。',
      },
    ]);
    expect(hasThinking).toBe(false);
    expect(hasToolCall).toBe(false);
  });

  it('maps reasoning messages to a thinking block', () => {
    const msg = parseAgentRepr(REASONING_REPR)!;
    const { blocks, hasThinking } = agentReprToBlocks(msg);
    expect(blocks).toEqual([
      { type: 'thinking', content: '先分析需求，\n再给出方案。' },
    ]);
    expect(hasThinking).toBe(true);
  });

  it('maps function_call to a tool_call block with arguments', () => {
    const msg = parseAgentRepr(TOOL_CALL_REPR)!;
    const { blocks, hasToolCall } = agentReprToBlocks(msg);
    expect(blocks).toEqual([
      {
        type: 'tool_call',
        payload: {
          type: 'tool_call',
          tool_name: 'read_file',
          arguments: '{"path": "~/SOUL.md"}',
          status: 'success',
          isStreaming: false,
        },
      },
    ]);
    expect(hasToolCall).toBe(true);
  });

  it('marks in_progress tool calls as running/streaming', () => {
    const msg = parseAgentRepr(TOOL_CALL_STREAMING_REPR)!;
    const { blocks } = agentReprToBlocks(msg);
    expect(blocks[0].payload?.status).toBe('running');
    expect(blocks[0].payload?.isStreaming).toBe(true);
  });

  it('maps function_call_output to a tool_call block with result', () => {
    const msg = parseAgentRepr(TOOL_OUTPUT_REPR)!;
    const { blocks, hasToolCall } = agentReprToBlocks(msg);
    expect(blocks).toEqual([
      {
        type: 'tool_call',
        payload: {
          type: 'tool_call',
          tool_name: 'read_file',
          result: '# SOUL\n内容',
          status: 'success',
        },
      },
    ]);
    expect(hasToolCall).toBe(true);
  });
});

describe('tryParseAgentReprBlocks', () => {
  it('returns null for empty-content reprs', () => {
    const empty =
      "object='message' status='completed' type='message' role='assistant' " +
      'content=[] code=None message=None usage=None metadata={}';
    expect(tryParseAgentReprBlocks(empty)).toBeNull();
  });
});

describe('parseA2uiContent integration', () => {
  it('parses Tool Guard confirmation prompts into an actionable block', () => {
    const result = parseA2uiContent(`⏳ Waiting for approval / 等待审批

Tool / 工具: execute_shell_command
Triggered by / 触发来源: Tool Guard / 工具护栏
Parameters / 参数:
{ "command": "rm /root/manager-workspace/pending-workers.json" }

💡 Triggered by tool guardrails
Type /approve to approve, or send any message to deny.

⚠️ Warning: Files outside workspace detected!
• ~/pending-workers.json → /root/manager-workspace/pending-workers.json`);

    expect(result.blocks).toEqual([
      {
        type: 'confirmation',
        payload: expect.objectContaining({
          toolName: 'execute_shell_command',
          triggeredBy: 'Tool Guard / 工具护栏',
          approveReply: '/approve',
          rejectReply: '拒绝',
        }),
      },
    ]);
  });

  it('parses repr bodies even when a formatted_body exists', () => {
    const result = parseA2uiContent(
      ASSISTANT_MESSAGE_REPR,
      '<p>sequence_number=88 object=\'message\' ...</p>'
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('text');
    expect(result.blocks[0].text).toContain('好的！');
  });

  it('routes reasoning reprs to thinking blocks', () => {
    const result = parseA2uiContent(REASONING_REPR);
    expect(result.hasThinking).toBe(true);
    expect(result.blocks[0].type).toBe('thinking');
  });

  it('routes tool call reprs to tool_call blocks', () => {
    const result = parseA2uiContent(TOOL_CALL_REPR);
    expect(result.hasToolCall).toBe(true);
    expect(result.blocks[0].type).toBe('tool_call');
  });

  it('preserves a prefix while parsing an embedded tool call repr', () => {
    const result = parseA2uiContent(`正在调用工具...\n${TOOL_CALL_REPR}`);
    expect(result.hasToolCall).toBe(true);
    expect(result.blocks).toEqual([
      { type: 'text', text: '正在调用工具...' },
      expect.objectContaining({ type: 'tool_call' }),
    ]);
  });

  it('preserves a suffix after an embedded repr', () => {
    const result = parseA2uiContent(`${TOOL_CALL_REPR}\n工具调用完成。`);
    expect(result.blocks).toEqual([
      expect.objectContaining({ type: 'tool_call' }),
      { type: 'text', text: '工具调用完成。' },
    ]);
  });

  it('preserves text on both sides of an embedded repr', () => {
    const result = parseA2uiContent(`正在调用工具...\n${TOOL_CALL_REPR}\n请稍候。`);
    expect(result.blocks).toEqual([
      { type: 'text', text: '正在调用工具...' },
      expect.objectContaining({ type: 'tool_call' }),
      { type: 'text', text: '请稍候。' },
    ]);
  });

  it('parses multiple reprs while preserving the text between them', () => {
    const result = parseA2uiContent(`${REASONING_REPR}\n正在读取文件...\n${TOOL_CALL_REPR}`);
    expect(result.hasThinking).toBe(true);
    expect(result.hasToolCall).toBe(true);
    expect(result.blocks).toEqual([
      expect.objectContaining({ type: 'thinking' }),
      { type: 'text', text: '正在读取文件...' },
      expect.objectContaining({ type: 'tool_call' }),
    ]);
  });

  it('leaves normal markdown messages untouched', () => {
    const result = parseA2uiContent('**加粗** 普通消息');
    expect(result.hasThinking).toBe(false);
    expect(result.hasToolCall).toBe(false);
    expect(result.blocks[0].type).toBe('text');
    expect(result.blocks[0].text).toBe('**加粗** 普通消息');
  });

  it('creates a workflow block from an AgentTeams workflow payload', () => {
    const result = parseA2uiContent('正在执行', undefined, {
      title: '发布流程',
      status: 'in_progress',
    });

    expect(result.blocks).toEqual([
      { type: 'workflow', payload: { title: '发布流程', status: 'in_progress' } },
    ]);
  });
});
