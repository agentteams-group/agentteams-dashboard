/**
 * 发送通道的 C-3 契约：干预答复要带上 `com.agentteams.answer` 结构化字段，
 * 并且把「这条消息是否真的进了房间」回传给调用方（卡片靠它决定显示状态）。
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ANSWER_CONTENT_KEY } from '../confirmation-reply';
import { useOutboundMessages } from './useOutboundMessages';

/** 只取断言用得到的那几个入参字段。 */
interface MutateArgs {
  roomId: string;
  body: string;
  extra: Record<string, unknown>;
  relatesTo?: unknown;
}
interface MutateCallbacks {
  onSuccess?: (_data: { event_id: string }) => void;
  onError?: (_err: Error) => void;
}

function setup({ ok = true }: { ok?: boolean } = {}) {
  const mutate = vi.fn(
    (_args: MutateArgs, callbacks?: MutateCallbacks) => {
      if (ok) callbacks?.onSuccess?.({ event_id: '$sent-1' });
      else callbacks?.onError?.(new Error('homeserver 拒绝'));
    },
  );
  const sendMutation = { mutate } as unknown as ReturnType<typeof import('@/hooks/use-matrix').useMatrixSendMessage>;
  const markAllRead = vi.fn();
  const hook = renderHook(() =>
    useOutboundMessages({
      roomId: '!r:example.org',
      isLoggedIn: true,
      userId: '@me:example.org',
      sendMutation,
      markAllRead,
    }),
  );
  return { hook, mutate, markAllRead };
}

describe('useOutboundMessages.sendOutbound（方案 v3 C-3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('带 answer 时把结构化字段并进 content，并回传 true', async () => {
    const { hook, mutate, markAllRead } = setup();
    const delivered = await hook.result.current.sendOutbound({
      content: '@ceshi 【干预答复】\nA1：按模块',
      referenceEventId: '$card',
      answer: { confirmation_id: 'iv-1', answer: 'A1：按模块', actor: '@me:example.org' },
    });

    expect(delivered).toBe(true);
    const args = mutate.mock.calls[0][0];
    expect(args.extra[ANSWER_CONTENT_KEY]).toEqual({
      confirmation_id: 'iv-1',
      answer: 'A1：按模块',
      actor: '@me:example.org',
    });
    expect(args.relatesTo).toEqual({ rel_type: 'm.reference', event_id: '$card' });
    expect(markAllRead).toHaveBeenCalledWith('$sent-1');
  });

  it('不带 answer 时 content 里不留这个字段（v1 工具确认与启发式卡）', async () => {
    const { hook, mutate } = setup();
    await hook.result.current.sendOutbound({ content: '/approve' });
    expect(mutate.mock.calls[0][0].extra[ANSWER_CONTENT_KEY]).toBeUndefined();
  });

  it('发送失败回传 false，而不是把失败吞成 undefined', async () => {
    const { hook } = setup({ ok: false });
    const delivered = await hook.result.current.sendOutbound({
      content: 'A1：按模块',
      answer: { confirmation_id: 'iv-1', answer: 'A1：按模块' },
    });
    expect(delivered).toBe(false);
  });

  it('未登录时同样明确回传 false（卡片不得据此显示已答复）', async () => {
    const sendMutation = { mutate: vi.fn() } as unknown as ReturnType<typeof import('@/hooks/use-matrix').useMatrixSendMessage>;
    const hook = renderHook(() =>
      useOutboundMessages({
        roomId: '!r:example.org',
        isLoggedIn: false,
        userId: '@me:example.org',
        sendMutation,
        markAllRead: vi.fn(),
      }),
    );
    expect(await hook.result.current.sendOutbound({ content: 'x' })).toBe(false);
    expect(sendMutation.mutate).not.toHaveBeenCalled();
  });
});
