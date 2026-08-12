/**
 * Runtime-aware dispatch tests (任务书 §6.2): copaw Thinking-prefix skip,
 * hermes keyword heuristic, run-ending sentinels, runtimeHint propagation.
 */
import { describe, expect, it } from 'vitest';
import { normalizeToBlocks, type NormalizeInput } from './normalize';

function makeInput(overrides: Partial<NormalizeInput>): NormalizeInput {
  return {
    body: '',
    content: { msgtype: 'm.text' },
    isStreaming: false,
    isMine: false,
    ...overrides,
  };
}

describe('rule 7: copaw never takes the Thinking: fallback (§6.2.2)', () => {
  it('parses a Thinking:-prefixed body as thinking for qwenpaw', () => {
    const blocks = normalizeToBlocks(makeInput({ body: 'Thinking:\n\n整理需求', runtime: 'qwenpaw' }));
    expect(blocks[0]).toMatchObject({ type: 'thinking', content: '整理需求', runtimeHint: 'qwenpaw' });
  });

  it('keeps a Thinking:-prefixed body as text when the runtime is copaw', () => {
    const blocks = normalizeToBlocks(makeInput({ body: 'Thinking:\n\n不是思考', runtime: 'copaw' }));
    expect(blocks[0].type).toBe('text');
  });

  it('keeps the generic behavior when runtime is unknown', () => {
    const blocks = normalizeToBlocks(makeInput({ body: 'Thinking:\n\n整理需求' }));
    expect(blocks[0].type).toBe('thinking');
    expect(blocks[0].runtimeHint).toBeUndefined();
  });
});

describe('rule 5: run-ending sentinels (§6.2.7 / R10)', () => {
  it.each([
    ['已取消', 'cancelled', '任务已取消'],
    ['处理异常', 'failed', '任务异常'],
    ['已处理', 'quiet', '已处理（无回复）'],
  ])('maps "%s" to an error block (%s)', (body, kind, title) => {
    const blocks = normalizeToBlocks(makeInput({ body }));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'error', payload: { kind, title } });
  });

  it('keeps the same words as text when sent by the current user', () => {
    const blocks = normalizeToBlocks(makeInput({ body: '已取消', isMine: true }));
    expect(blocks[0].type).toBe('text');
  });

  it('requires a whole-body exact match', () => {
    for (const body of ['已取消。', '任务已取消', '已取消\n详见日志', ' 已处理 好了']) {
      const blocks = normalizeToBlocks(makeInput({ body }));
      expect(blocks[0].type, body).toBe('text');
    }
  });

  it('tolerates surrounding whitespace', () => {
    const blocks = normalizeToBlocks(makeInput({ body: '  已取消\n' }));
    expect(blocks[0]).toMatchObject({ type: 'error', payload: { kind: 'cancelled' } });
  });
});

describe('rule 10: tool-keyword notices (§6.2.3 / R11)', () => {
  it('recognizes "tool: name" notices as low-confidence tool calls', () => {
    const blocks = normalizeToBlocks(
      makeInput({ body: 'tool: web_search', content: { msgtype: 'm.notice' }, runtime: 'hermes' }),
    );
    expect(blocks[0]).toMatchObject({
      type: 'tool_call',
      runtimeHint: 'hermes',
      payload: { tool_name: 'web_search', confidence: 'low' },
    });
  });

  it('recognizes calling/invoking wording', () => {
    for (const body of ['calling read_file now', 'invoking apply_patch']) {
      const blocks = normalizeToBlocks(makeInput({ body, content: { msgtype: 'm.notice' } }));
      expect(blocks[0].type, body).toBe('tool_call');
      expect(blocks[0].payload?.confidence).toBe('low');
    }
  });

  it('keeps keyword-free agent notices as thinking blocks', () => {
    const blocks = normalizeToBlocks(
      makeInput({ body: '正在整理思路，然后给出结论', content: { msgtype: 'm.notice' } }),
    );
    expect(blocks[0].type).toBe('thinking');
  });

  it('keeps the user’s own keyword notice as text', () => {
    const blocks = normalizeToBlocks(
      makeInput({ body: 'tool: x', content: { msgtype: 'm.notice' }, isMine: true }),
    );
    expect(blocks[0].type).toBe('text');
  });

  it('still folds the run placeholder to text before the keyword rule can fire', () => {
    const blocks = normalizeToBlocks(makeInput({ body: '处理中...', content: { msgtype: 'm.notice' } }));
    expect(blocks[0].type).toBe('text');
  });
});

describe('runtimeHint propagation (§6.2.1)', () => {
  it('stamps every produced block with the resolved runtime', () => {
    const blocks = normalizeToBlocks(
      makeInput({
        body: '前缀\n```card\n{"type":"tool_call","tool_name":"read_file"}\n```\n后缀',
        runtime: 'openclaw',
      }),
    );
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.runtimeHint).toBe('openclaw');
    }
  });

  it('does not stamp blocks when runtime is null', () => {
    const blocks = normalizeToBlocks(makeInput({ body: '普通消息', runtime: null }));
    expect(blocks[0].runtimeHint).toBeUndefined();
  });
});
