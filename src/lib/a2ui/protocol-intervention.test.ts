import { describe, expect, it } from 'vitest';
import {
  isInterventionConfirmation,
  normalizeConfirmationPayload,
  type RuntimeConfirmationBlock,
} from './protocol';

function confirm(raw: unknown): RuntimeConfirmationBlock {
  const block = normalizeConfirmationPayload(raw);
  if (!block) throw new Error('normalizeConfirmationPayload returned undefined');
  return block;
}

describe('normalizeConfirmationPayload — v1 工具确认（向后兼容）', () => {
  it('v1 块不带干预字段照常归一化', () => {
    const block = confirm({
      tool_name: 'browser.click',
      confirmation_id: 'c1',
      parameters: '{}',
      expires_at: 123,
    });
    expect(block.payload).toEqual({
      tool_name: 'browser.click',
      confirmation_id: 'c1',
      parameters: '{}',
      expires_at: 123,
    });
    expect(isInterventionConfirmation(block)).toBe(false);
  });

  it('缺 confirmation_id 仍返回 undefined（回落文本启发式）', () => {
    expect(normalizeConfirmationPayload({ tool_name: 'x' })).toBeUndefined();
  });
});

describe('normalizeConfirmationPayload — v2 干预字段（F2.1 消费侧）', () => {
  it('question + options（含推荐项与说明）透传', () => {
    const block = confirm({
      tool_name: 'ask_human',
      confirmation_id: 'q1',
      question: '泳道按什么维度划分？',
      options: [
        { id: 'a', label: '按模块', description: '每个模块一条泳道' },
        { id: 'b', label: '按角色', recommended: true },
        { id: 'bad' },
        'junk',
      ],
    });
    expect(block.payload.question).toBe('泳道按什么维度划分？');
    expect(block.payload.options).toEqual([
      { id: 'a', label: '按模块', description: '每个模块一条泳道' },
      { id: 'b', label: '按角色', recommended: true },
    ]);
    expect(isInterventionConfirmation(block)).toBe(true);
  });

  it('多问题分页形态 questions[] 透传（子问题缺 question 剔除）', () => {
    const block = confirm({
      tool_name: 'ask_human',
      confirmation_id: 'q2',
      questions: [
        { id: 'q2-1', question: '先做哪端？', options: [{ id: 'web', label: 'Web' }] },
        { question: '多选偏好', multi_select: true, options: [{ id: 'x', label: 'X' }] },
        { options: [{ id: 'y', label: 'Y' }] },
      ],
    });
    expect(block.payload.questions).toEqual([
      { id: 'q2-1', question: '先做哪端？', options: [{ id: 'web', label: 'Web' }] },
      { question: '多选偏好', options: [{ id: 'x', label: 'X' }], multi_select: true },
    ]);
  });

  it('requested_of / answer_schema 透传（requested_of 为空串不带）', () => {
    const block = confirm({
      tool_name: 'ask_human',
      confirmation_id: 'q3',
      question: '？',
      requested_of: '@alice:example.org',
      answer_schema: { type: 'object' },
    });
    expect(block.payload.requested_of).toBe('@alice:example.org');
    expect(block.payload.answer_schema).toEqual({ type: 'object' });
    const noTarget = confirm({
      tool_name: 'ask_human',
      confirmation_id: 'q4',
      question: '？',
      requested_of: '',
    });
    expect(noTarget.payload.requested_of).toBeUndefined();
  });

  it('只有 options 没有 question 也判定为干预卡（分渲染依据字段存在）', () => {
    const block = confirm({
      tool_name: 'ask_human',
      confirmation_id: 'q5',
      options: [{ id: 'ok', label: '继续' }],
    });
    expect(isInterventionConfirmation(block)).toBe(true);
  });
});
