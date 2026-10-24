import { describe, expect, it } from 'vitest';
import { isHitlResolutionReply } from '@/lib/hitl-inbox';
import { buildConfirmationReply } from './confirmation-reply';

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
