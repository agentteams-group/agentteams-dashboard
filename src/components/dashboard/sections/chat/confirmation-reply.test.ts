import { describe, expect, it } from 'vitest';
import { isHitlResolutionReply } from '@/lib/hitl-inbox';
import {
  ANSWER_CONTENT_KEY,
  buildAnswerContent,
  buildConfirmationReply,
} from './confirmation-reply';

const WORKER = '@ceshi:matrix-local.agentteams.io:18080';
const WORKER_2 = '@other:matrix-local.agentteams.io:18080';

describe('buildConfirmationReply', () => {
  it('Worker 房间默认 @ 发起卡片的 Agent', () => {
    const reply = buildConfirmationReply('1A / 2A', WORKER, [WORKER]);
    expect(reply.content).toBe('@ceshi 1A / 2A');
    expect(reply.mentions).toEqual([
      { userId: WORKER, displayName: 'ceshi', placeholder: '@ceshi' },
    ]);
  });

  it('拿不到发送者时退回房间的第一个 Worker', () => {
    const reply = buildConfirmationReply('1A', undefined, [WORKER]);
    expect(reply.content).toBe('@ceshi 1A');
    expect(reply.mentions?.[0].userId).toBe(WORKER);
  });

  it('Team 房间优先 @ 实际发起卡片的 Worker', () => {
    const reply = buildConfirmationReply('1A', WORKER_2, [WORKER, WORKER_2]);
    expect(reply.content).toBe('@other 1A');
    expect(reply.mentions?.[0].userId).toBe(WORKER_2);
  });

  it('Manager / Human 房间不追加 @', () => {
    expect(buildConfirmationReply('1A', '@manager:example.com', undefined)).toEqual({
      content: '1A',
    });
    expect(buildConfirmationReply('1A', '@manager:example.com', [])).toEqual({
      content: '1A',
    });
  });

  it('追加 @ 后的审批与干预答复仍可被收件箱识别', () => {
    const approved = buildConfirmationReply('/approve', WORKER, [WORKER]);
    expect(isHitlResolutionReply(approved.content)).toBe(true);

    const answered = buildConfirmationReply('【干预答复】\nA1：落地页', WORKER, [WORKER]);
    expect(isHitlResolutionReply(answered.content)).toBe(true);
  });
});

describe('buildAnswerContent（方案 v3 C-3 结构化回写）', () => {
  it('带上 confirmation_id / answer / actor，可直接并进消息 content', () => {
    const extra = buildAnswerContent({
      confirmation_id: 'iv-1',
      answer: '【干预答复】\nA1：按模块',
      actor: WORKER,
      tool_name: 'ask_human',
    });
    expect(extra).toEqual({
      [ANSWER_CONTENT_KEY]: {
        confirmation_id: 'iv-1',
        answer: '【干预答复】\nA1：按模块',
        actor: WORKER,
        tool_name: 'ask_human',
      },
    });
  });

  it('没有卡片 id 时整个字段省略：不带字段胜过带一个对不上号的 id', () => {
    expect(buildAnswerContent(undefined)).toBeUndefined();
    expect(buildAnswerContent({ confirmation_id: '', answer: 'x' })).toBeUndefined();
    expect(buildAnswerContent({ confirmation_id: '   ', answer: 'x' })).toBeUndefined();
  });
});
