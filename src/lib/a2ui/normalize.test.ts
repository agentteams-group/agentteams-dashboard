import { describe, expect, it } from 'vitest';
import { normalizeToBlocks, type NormalizeInput } from '@/lib/a2ui/normalize';

function makeInput(partial: Partial<NormalizeInput> = {}): NormalizeInput {
  return {
    body: 'hello',
    formattedBody: undefined,
    content: {},
    isStreaming: false,
    ...partial,
  };
}

describe('normalizeToBlocks rule 1: agentteams.workflow', () => {
  it('produces a workflow block and ignores everything else', () => {
    const input = makeInput({
      body: '```a2ui\n{"version":"v0.9","createSurface":{}}\n```',
      content: { 'agentteams.workflow': { title: '发布流程', status: 'in_progress' } },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('workflow');
    expect(
      (blocks[0] as unknown as { payload: { title: string } }).payload.title
    ).toBe('发布流程');
  });
});

describe('normalizeToBlocks rule 2: org.agentteams.run', () => {
  it('produces structured blocks from an agent run payload', () => {
    const input = makeInput({
      body: 'irrelevant',
      content: {
        'org.agentteams.run': {
          blocks: [
            { type: 'thinking', content: '分析中' },
            { type: 'text', text: '分析结果' },
          ],
        },
      },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('thinking');
    expect(blocks[1].type).toBe('text');
  });
});

describe('normalizeToBlocks rule 3: A2UI markers', () => {
  it('parses a fenced a2ui block', () => {
    const input = makeInput({
      body: '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"c"}}\n```',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('a2ui');
  });

  it('parses an HTML comment a2ui marker', () => {
    const input = makeInput({
      body: '<p>text</p>',
      formattedBody: '<!--a2ui:{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"c"}}-->',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('a2ui');
  });
});

describe('normalizeToBlocks rule 4: Tool Guard confirmation', () => {
  it('produces a confirmation block from approval text', () => {
    const input = makeInput({
      body: `⏳ Waiting for approval / 等待审批\n\n**Agent** wants to run a command.\n\nType /approve to approve, or send any message to deny.`,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('confirmation');
  });
});

describe('normalizeToBlocks rule 6: agentscope repr dump', () => {
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

  it('parses a reasoning repr into a thinking block', () => {
    const input = makeInput({ body: REASONING_REPR });

    const blocks = normalizeToBlocks(input);
    expect(blocks.some(b => b.type === 'thinking')).toBe(true);
  });

  it('parses a function_call repr into a tool_call block', () => {
    const input = makeInput({ body: TOOL_CALL_REPR });

    const blocks = normalizeToBlocks(input);
    expect(blocks.some(b => b.type === 'tool_call')).toBe(true);
  });
});

describe('normalizeToBlocks rule 7: Thinking: prefix (qwenpaw)', () => {
  it('strips the prefix and produces a thinking block', () => {
    const input = makeInput({ body: 'Thinking:\n\n我正在思考这个问题。' });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('thinking');
    expect((blocks[0] as { content: string }).content).toBe('我正在思考这个问题。');
  });

  it('keeps ordinary text that merely starts with the word Thinking:', () => {
    const input = makeInput({ body: 'Thinking: fast is better than slow.' });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });
});

describe('normalizeToBlocks rule 8: com.agentteams.long_message', () => {
  it('maps long-message metadata to an attachment block', () => {
    const input = makeInput({
      body: '正文被截断…',
      content: {
        'com.agentteams.long_message': {
          version: 1,
          url: 'mxc://example.com/abc123',
          filename: 'full-reply.txt',
          mimetype: 'text/plain',
        },
      },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('attachment');
    const payload = (blocks[0] as unknown as { payload: { url: string; filename: string } }).payload;
    expect(payload.url).toBe('mxc://example.com/abc123');
    expect(payload.filename).toBe('full-reply.txt');
  });

  it('ignores incomplete long-message metadata', () => {
    const input = makeInput({
      body: '普通文本',
      content: { 'com.agentteams.long_message': { version: 1 } },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });
});

describe('normalizeToBlocks rule 9: Hermes 🔧 tool-call Markdown', () => {
  it('parses a hermes tool call into a tool_call block', () => {
    const input = makeInput({
      body: '🔧 **teamharness__taskflow**\n```\n{"action":"check_task","payload":{"taskId":"task-1"}}\n```',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('tool_call');
    const payload = blocks[0].payload as { tool_name: string; arguments: Record<string, unknown> };
    expect(payload.tool_name).toBe('teamharness__taskflow');
    expect(payload.arguments).toEqual({ action: 'check_task', payload: { taskId: 'task-1' } });
  });

  it('keeps surrounding text as text blocks', () => {
    const input = makeInput({
      body: '先查一下任务状态。\n🔧 **recall_history**\n```\n{"op":"expand","lo":1,"hi":50}\n```\n调用完成。',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool_call', 'text']);
  });

  it('falls back to a raw value when the arguments are not JSON', () => {
    const input = makeInput({
      body: '🔧 **execute_shell_command**\n```\nls -la\n```',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    const payload = blocks[0].payload as { tool_name: string; arguments: Record<string, unknown> };
    expect(payload.tool_name).toBe('execute_shell_command');
    expect(payload.arguments).toEqual({ value: 'ls -la' });
  });

  it('treats an unclosed fence while streaming as plain text', () => {
    const input = makeInput({
      body: '🔧 **execute_shell_command**\n```\n{"command":"ls"',
      isStreaming: true,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });
});

describe('normalizeToBlocks rule 11: agent m.notice process messages', () => {
  it('renders an agent notice as a collapsed thinking block', () => {
    const input = makeInput({
      body: 'The user is asking for the latest progress. Let me check.',
      content: { msgtype: 'm.notice' },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'thinking',
      content: 'The user is asking for the latest progress. Let me check.',
      isStreaming: false,
    });
  });

  it('keeps the run placeholder body as text', () => {
    const input = makeInput({ body: '处理中...', content: { msgtype: 'm.notice' } });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });

  it('keeps the user own notice as text', () => {
    const input = makeInput({
      body: '我自己发的提示',
      content: { msgtype: 'm.notice' },
      isMine: true,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });

  it('keeps ordinary m.text messages as text', () => {
    const input = makeInput({
      body: '我目前有 6 个技能',
      content: { msgtype: 'm.text' },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });

  it('prefers a hermes tool call even when sent as a notice', () => {
    const input = makeInput({
      body: '🔧 **search**\n```\n{"query":"状态"}\n```',
      content: { msgtype: 'm.notice' },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('tool_call');
  });
});

describe('normalizeToBlocks rule 12: legacy card/details', () => {
  it('parses a fenced card into a card block', () => {
    const input = makeInput({
      body: '前缀\n```card\n{"title":"部署状态","content":"服务正常"}\n```\n后缀',
    });

    const blocks = normalizeToBlocks(input);
    const card = blocks.find(b => b.type === 'card');
    expect(card).toBeDefined();
  });

  it('parses an HTML thinking details into a thinking block', () => {
    const input = makeInput({
      formattedBody: '<p>text</p><details class="thinking">内部思考</details>',
      body: '<p>text</p><details class="thinking">内部思考</details>',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks.some(b => b.type === 'thinking')).toBe(true);
  });
});

describe('normalizeToBlocks rule 13: text fallback', () => {
  it('renders plain body as a single text block', () => {
    const input = makeInput({ body: '**加粗** 普通消息' });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect((blocks[0] as { text: string }).text).toBe('**加粗** 普通消息');
  });
});

describe('normalizeToBlocks priority conflict', () => {
  it('workflow key wins over A2UI markers', () => {
    const input = makeInput({
      body: '```a2ui\n{"version":"v0.9","createSurface":{}}\n```',
      content: { 'agentteams.workflow': { title: 'x', status: 'success' } },
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('workflow');
  });

  it('A2UI marker wins over a Thinking: prefix in the same body', () => {
    const input = makeInput({
      body: 'Thinking:\n\n```a2ui\n{"version":"v0.9","createSurface":{}}\n```',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).not.toBe('thinking');
    expect(blocks.some(b => b.type === 'a2ui')).toBe(true);
  });

  it('Thinking: prefix wins over legacy card text', () => {
    const input = makeInput({
      body: 'Thinking:\n\n```card\n{"title":"t"}\n```',
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('thinking');
  });
});

describe('normalizeToBlocks streaming tolerance', () => {
  it('produces an a2ui placeholder block for an unclosed fence while streaming', () => {
    const input = makeInput({
      body: '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s"}}',
      isStreaming: true,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('a2ui');
    expect(blocks[0].isStreaming).toBe(true);
    expect(blocks[0].messages).toBeUndefined();
  });

  it('falls through to text for an unclosed fence after streaming ends', () => {
    const input = makeInput({
      body: '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s"}}',
      isStreaming: false,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });

  it('produces an a2ui placeholder block for an unclosed HTML comment while streaming', () => {
    const input = makeInput({
      body: '<p>正在生成</p>',
      formattedBody: '<p>正在生成</p><!--a2ui:{"version":"v0.9","createSurface":{"surfaceId":"s"}',
      isStreaming: true,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('a2ui');
    expect(blocks[0].isStreaming).toBe(true);
  });

  it('parses a fully closed a2ui fence normally while streaming', () => {
    const input = makeInput({
      body: '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"c"}}\n```',
      isStreaming: true,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('a2ui');
    expect(blocks[0].isStreaming).toBeUndefined();
  });

  it('degraded to text when the JSON is malformed but the fence is closed', () => {
    const input = makeInput({
      body: '```a2ui\n{not valid json\n```',
      isStreaming: true,
    });

    const blocks = normalizeToBlocks(input);
    expect(blocks[0].type).toBe('text');
  });
});
