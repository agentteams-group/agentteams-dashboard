/**
 * 工具审批卡（#235）单测：QwenPaw 运行时审批模板字段渲染、无请求 ID
 * 禁绑按钮、带 ID 精确绑定、提交中防重、失败可重试、收件箱互通只读、
 * 过期只读、蛇形 v1 payload 适配。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import {
  ConfirmationCard,
  toConfirmationCardPayload,
  type ConfirmationCardPayload,
} from './confirmation-card';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import type { AnswerSendResult, ConfirmationAnswerField } from './confirmation-reply';

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: (selector: (_s: { userId: string | null }) => unknown) =>
    selector({ userId: '@me:example.org' }),
}));

// 默认回报「已写入房间」；单测可切 mock 验证失败路径。
const mockOnApprove = vi.fn<(_reply: string, _answer?: ConfirmationAnswerField) => AnswerSendResult>(() => true);
const mockOnReject = vi.fn<(_reply: string, _answer?: ConfirmationAnswerField) => AnswerSendResult>(() => true);
const mockOnCancel = vi.fn<(_reply: string, _answer?: ConfirmationAnswerField) => AnswerSendResult>(() => true);

const boundPayload: ConfirmationCardPayload = {
  toolName: 'execute_shell_command',
  severity: 'CRITICAL',
  riskDetails: '- [CRITICAL] 递归删除高危命令',
  parameters: '{ "command": "rm -rf /tmp/build" }',
  requestId: 'req-abc-123',
  approveReply: '/approval approve req-abc-123',
  rejectReply: '/approval deny req-abc-123',
  cancelReply: '/approval cancel req-abc-123',
};

const unboundPayload: ConfirmationCardPayload = {
  toolName: 'execute_shell_command',
  severity: 'HIGH',
  approveReply: '/approval approve',
  rejectReply: '/approval deny',
};

function renderCard(payload: ConfirmationCardPayload) {
  return render(
    <ConfirmationCard
      payload={payload}
      onApprove={mockOnApprove}
      onReject={mockOnReject}
      onCancel={mockOnCancel}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useHitlInboxStore.setState({ confirmations: {}, resolutions: {} });
});

describe('toConfirmationCardPayload（蛇形 v1 → 卡片契约）', () => {
  it('maps snake_case v1 fields onto the camelCase card payload', () => {
    expect(toConfirmationCardPayload({
      tool_name: 'bash',
      confirmation_id: 'conf-1',
      severity: 'HIGH',
      risk_details: '- [HIGH] 写系统路径',
      parameters: '{ "path": "/etc" }',
    })).toEqual({
      toolName: 'bash',
      triggeredBy: undefined,
      parameters: '{ "path": "/etc" }',
      approveReply: '/approve',
      rejectReply: '拒绝',
      severity: 'HIGH',
      riskDetails: '- [HIGH] 写系统路径',
      findings: undefined,
      requestId: 'conf-1',
      cancelReply: undefined,
      expiresAt: undefined,
    });
  });

  it('prefers confirmation_id and reads expires_at when both shapes appear', () => {
    const payload = toConfirmationCardPayload({
      toolName: 'bash',
      requestId: 'req-9',
      confirmation_id: 'conf-9',
      severity: 'LOW',
      expires_at: 123,
    });
    expect(payload.requestId).toBe('conf-9');
    expect(payload.expiresAt).toBe(123);
  });

  it('falls back to defaults for a bare heuristic payload', () => {
    const payload = toConfirmationCardPayload({ toolName: 'execute_shell_command' });
    expect(payload.toolName).toBe('execute_shell_command');
    expect(payload.approveReply).toBe('/approve');
    expect(payload.requestId).toBeUndefined();
  });
});

describe('ConfirmationCard（#235 审批交互）', () => {
  it('renders the severity badge, risk details and request id', () => {
    renderCard(boundPayload);
    expect(screen.getAllByText('CRITICAL').length).toBeGreaterThan(0);
    expect(screen.getByText('- [CRITICAL] 递归删除高危命令')).toBeInTheDocument();
    expect(screen.getByText('请求 ID：req-abc-123')).toBeInTheDocument();
    expect(screen.getAllByText(/execute_shell_command/).length).toBeGreaterThan(0);
  });

  it('renders no badge for an unrecognised severity word', () => {
    renderCard({ ...boundPayload, severity: 'WHO_KNOWS' });
    expect(screen.queryByText('WHO_KNOWS')).not.toBeInTheDocument();
  });

  it('does not bind buttons without a request id (no guessing the queue head)', () => {
    renderCard(unboundPayload);
    expect(screen.getByRole('button', { name: /批准本次/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /拒绝本次/ })).toBeDisabled();
    expect(screen.getByText(/无法精确绑定本次请求/)).toBeInTheDocument();
    expect(screen.queryByText('/approval approve')).not.toBeInTheDocument();
  });

  it('sends the id-bound command plus the structured answer field on approve', async () => {
    renderCard(boundPayload);
    fireEvent.click(screen.getByRole('button', { name: /批准本次/ }));
    await waitFor(() =>
      expect(mockOnApprove).toHaveBeenCalledWith('/approval approve req-abc-123', {
        confirmation_id: 'req-abc-123',
        answer: 'approved',
        tool_name: 'execute_shell_command',
        actor: '@me:example.org',
      }),
    );
    expect(await screen.findByText(/已提交，等待运行时确认/)).toBeInTheDocument();
  });

  it('sends the id-bound deny command on reject', async () => {
    renderCard(boundPayload);
    fireEvent.click(screen.getByRole('button', { name: /拒绝本次/ }));
    await waitFor(() =>
      expect(mockOnReject).toHaveBeenCalledWith('/approval deny req-abc-123', {
        confirmation_id: 'req-abc-123',
        answer: 'rejected',
        tool_name: 'execute_shell_command',
        actor: '@me:example.org',
      }),
    );
    expect(await screen.findByText(/已提交，等待运行时确认/)).toBeInTheDocument();
  });

  it('sends the cancel command when the runtime offers one', async () => {
    renderCard(boundPayload);
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    await waitFor(() =>
      expect(mockOnCancel).toHaveBeenCalledWith('/approval cancel req-abc-123', {
        confirmation_id: 'req-abc-123',
        answer: 'cancelled',
        tool_name: 'execute_shell_command',
        actor: '@me:example.org',
      }),
    );
    expect(await screen.findByText(/已提交，等待运行时确认/)).toBeInTheDocument();
  });

  it('stays retryable and shows a hint when the reply was not written to the room', async () => {
    mockOnApprove.mockReturnValueOnce(false);
    renderCard(boundPayload);
    fireEvent.click(screen.getByRole('button', { name: /批准本次/ }));
    expect(await screen.findByText('发送失败，请重试')).toBeInTheDocument();
    // 未翻成已答复：仍可再次提交。
    expect(screen.getByRole('button', { name: /批准本次/ })).toBeEnabled();
    mockOnApprove.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: /批准本次/ }));
    expect(await screen.findByText(/已提交，等待运行时确认/)).toBeInTheDocument();
  });

  it('treats a rejected send promise as a failure', async () => {
    mockOnReject.mockRejectedValueOnce(new Error('offline'));
    renderCard(boundPayload);
    fireEvent.click(screen.getByRole('button', { name: /拒绝本次/ }));
    expect(await screen.findByText('发送失败，请重试')).toBeInTheDocument();
  });

  it('goes read-only when another actor resolved the same request', () => {
    useHitlInboxStore.setState({
      resolutions: {
        'req-abc-123': {
          id: 'req-abc-123',
          status: 'answered',
          actor: '@boss:example.org',
          answer: '/approval approve req-abc-123',
          timestamp: 1,
        },
      },
    });
    renderCard(boundPayload);
    expect(screen.getAllByText(/已处理/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /批准本次/ })).not.toBeInTheDocument();
  });

  it('renders an expired card read-only', () => {
    renderCard({ ...boundPayload, expiresAt: Date.now() - 60_000 });
    expect(screen.getByText(/已超时/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /批准本次/ })).not.toBeInTheDocument();
  });

  it('keeps approval controls inline without opening a dialog', () => {
    render(<ConfirmationCard payload={boundPayload} onApprove={mockOnApprove} onReject={mockOnReject} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准本次' })).toBeVisible();
    expect(screen.getByRole('button', { name: '拒绝本次' })).toBeVisible();
    expect(screen.getByText('- [CRITICAL] 递归删除高危命令')).toBeInTheDocument();
  });
});
