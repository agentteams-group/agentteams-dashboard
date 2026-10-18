/**
 * 选项式干预卡（F2.1/F2.2）单测：推荐置顶默认选中、自由输入互斥、
 * 序号快捷键、提交禁用规则、降级回写文本、提交后只读 + 收件箱互通、
 * 超时置灰 + 升级通知、requested_of 权限门。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { InterventionCard, composeAnswerText } from './intervention-card';
import type { RuntimeConfirmationBlock } from '@/lib/a2ui/protocol';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

const mockAddNotification = vi.fn();
const mockOnAnswer = vi.fn();

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: (selector: (_s: { userId: string | null }) => unknown) =>
    selector({ userId: '@me:example.org' }),
}));

vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: (selector: (_s: { userLevel: number }) => unknown) =>
    selector({ userLevel: 3 }),
}));

vi.mock('@/lib/notification-store', () => ({
  useNotificationStore: (selector: (_s: { addNotification: typeof mockAddNotification }) => unknown) =>
    selector({ addNotification: mockAddNotification }),
}));

const basePayload: RuntimeConfirmationBlock['payload'] = {
  tool_name: 'ask_human',
  confirmation_id: 'iv-test-1',
  question: '你希望泳道按什么维度划分？',
  options: [
    { id: 'module', label: '按模块', description: '每个模块一条泳道' },
    { id: 'role', label: '按角色', recommended: true },
  ],
};

describe('composeAnswerText（降级自然语言回写）', () => {
  it('选中项映射为 label，多问题 A1/A2 逐行', () => {
    const text = composeAnswerText(
      [
        { question: 'Q1', options: [{ id: 'role', label: '按角色' }] },
        { question: 'Q2', options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }] },
      ],
      { selections: { 0: ['role'], 1: ['a', 'b'] }, freeText: {} },
    );
    expect(text).toBe('【干预答复】\nA1：按角色\nA2：甲、乙');
  });

  it('无选项时回退自由输入，两者皆空标注未作答', () => {
    const text = composeAnswerText(
      [{ question: 'Q', options: [{ id: 'x', label: 'X' }] }],
      { selections: {}, freeText: { 0: '自定义想法' } },
    );
    expect(text).toContain('A1：自定义想法');
    const empty = composeAnswerText([{ question: 'Q' }], { selections: {}, freeText: {} });
    expect(empty).toContain('（未作答）');
  });
});

describe('InterventionCard（F2.1 交互契约）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHitlInboxStore.setState({ confirmations: {} });
  });

  it('① 推荐项置顶 + 默认选中；序号随展示序', () => {
    render(<InterventionCard payload={basePayload} onAnswer={mockOnAnswer} />);
    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveAttribute('aria-checked', 'true'); // 推荐项默认选中
    expect(buttons[0]).toHaveTextContent('按角色');
    expect(buttons[1]).toHaveTextContent('按模块');
    expect(buttons[1]).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
  });

  it('② 自由输入与选项互斥：输入后清空选项，再点选项清空输入', () => {
    render(<InterventionCard payload={basePayload} onAnswer={mockOnAnswer} />);
    fireEvent.change(screen.getByLabelText(/自由输入/), { target: { value: '自定义' } });
    expect(screen.getByRole('radio', { name: /按角色/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('radio', { name: /按模块/ }));
    expect(screen.getByLabelText(/自由输入/)).toHaveValue('');
    expect(screen.getByRole('radio', { name: /按模块/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('③ 序号快捷键 1-9 选中展示序选项（输入框聚焦时让位）', () => {
    render(<InterventionCard payload={basePayload} onAnswer={mockOnAnswer} />);
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByRole('radio', { name: /按模块/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('④ 提交按钮禁用规则：推荐默认选中即可提交；取消选中且无输入则禁用', () => {
    render(<InterventionCard payload={basePayload} onAnswer={mockOnAnswer} />);
    const submit = screen.getByRole('button', { name: '提交答复' });
    expect(submit).toBeEnabled(); // 推荐项默认选中
    fireEvent.click(screen.getByRole('radio', { name: /按角色/ })); // 取消选中
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/自由输入/), { target: { value: '就这样' } });
    expect(submit).toBeEnabled();
  });

  it('⑤ 提交后：只读态显示提交人与时间、答案转自然语言经 onAnswer 发出、收件箱互通消失', () => {
    useHitlInboxStore.getState().upsertConfirmation({
      id: 'iv-test-1',
      roomId: '!r:example.org',
      eventId: '$e1',
      sender: '@agent:example.org',
      toolName: 'ask_human',
      approveReply: '/approve',
      rejectReply: '拒绝',
      question: '你希望泳道按什么维度划分？',
      timestamp: Date.now(),
    });
    render(<InterventionCard payload={basePayload} onAnswer={mockOnAnswer} />);
    fireEvent.click(screen.getByRole('radio', { name: /按模块/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交答复' }));
    expect(mockOnAnswer).toHaveBeenCalledTimes(1);
    expect(mockOnAnswer.mock.calls[0][0]).toContain('【干预答复】');
    expect(mockOnAnswer.mock.calls[0][0]).toContain('A1：按模块');
    // 只读态 + 提交人
    expect(screen.getByText(/已答复/)).toBeInTheDocument();
    expect(screen.getByText(/提交人 @me:example\.org/)).toBeInTheDocument();
    // F2.3 收件箱互通
    expect(useHitlInboxStore.getState().confirmations['iv-test-1']).toBeUndefined();
  });

  it('⑥ 超时（expires_at 已过）：置灰禁答 + 已超时徽标 + 升级通知一次', () => {
    render(
      <InterventionCard
        payload={{ ...basePayload, expires_at: Date.now() - 1000 }}
        onAnswer={mockOnAnswer}
      />,
    );
    expect(screen.getByText('已超时')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交答复' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /按角色/ })).toBeDisabled();
    expect(mockAddNotification).toHaveBeenCalledTimes(1);
    expect(mockAddNotification.mock.calls[0][0].title).toContain('超时');
  });

  it('⑦ requested_of 非本人且非管理员 → 不可操作提示；管理员可代答', () => {
    // 本模块 mock 固定 userLevel=3（管理员）→ 可代答
    render(
      <InterventionCard
        payload={{ ...basePayload, requested_of: '@alice:example.org' }}
        onAnswer={mockOnAnswer}
      />,
    );
    expect(screen.queryByText(/指定由/)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /按角色/ })).toBeEnabled();
  });
});
