'use client';

import { useEffect, useState } from 'react';
import { Shield, Check, X, ChevronDown, ChevronRight, Ban, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApprovalSeverityBadge } from '@/components/dashboard/approval-severity-badge';
import { useMatrixStore } from '@/lib/matrix-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import type { AnswerSendResult, ConfirmationAnswerField } from './confirmation-reply';

export interface ConfirmationCardPayload {
  toolName: string;
  triggeredBy?: string;
  parameters?: string;
  approveReply: string;
  rejectReply: string;
  /** #235：运行时风险等级（CRITICAL/HIGH/MEDIUM/LOW/INFO），按词归色展示。 */
  severity?: string;
  /** #235：风险明细（findings 摘要行）。 */
  riskDetails?: string;
  /** #235：命中规则数（运行时提供时展示）。 */
  findings?: number;
  /**
   * #235：运行时请求 ID。有它才能把按钮精确绑定到本次请求
   * （`/approval approve <id>` + `com.agentteams.answer` 回写）；
   * 缺失时禁绑按钮——无 ID 的命令会命中运行时队列首的任意请求。
   */
  requestId?: string;
  /** #235：取消命令（`/approval cancel <id>`），运行时提供时才出现。 */
  cancelReply?: string;
  /** #235：过期时间戳（毫秒）；过期后只读并标「已超时」。 */
  expiresAt?: number;
}

interface ConfirmationCardProps {
  payload: ConfirmationCardPayload;
  onApprove: (_reply: string, _answer?: ConfirmationAnswerField) => AnswerSendResult;
  onReject: (_reply: string, _answer?: ConfirmationAnswerField) => AnswerSendResult;
  onCancel?: (_reply: string, _answer?: ConfirmationAnswerField) => AnswerSendResult;
}

/**
 * 解析块 payload → 卡片 payload 的归一适配。
 *
 * 文本启发式路径（Tool Guard / QwenPaw 审批模板）产出驼峰字段
 * （`toolName` / `approveReply`）；`org.agentteams.run` v1 结构化路径是
 * 蛇形字段（`tool_name` / `confirmation_id` / `risk_details`）。两种形状在
 * 这里合成卡片唯一认得的契约，渲染侧不再各自猜测。
 */
export function toConfirmationCardPayload(payload: Record<string, unknown>): ConfirmationCardPayload {
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value : undefined;
  const confirmationId = str(payload.confirmation_id) ?? str(payload.requestId);
  return {
    toolName: str(payload.toolName) ?? str(payload.tool_name) ?? '未知工具',
    triggeredBy: str(payload.triggeredBy),
    parameters: str(payload.parameters),
    // v1 结构化路径没有文本命令约定，沿用收件箱抽取的同一套缺省。
    approveReply: str(payload.approveReply) ?? '/approve',
    rejectReply: str(payload.rejectReply) ?? '拒绝',
    severity: str(payload.severity),
    riskDetails: str(payload.riskDetails) ?? str(payload.risk_details),
    findings: typeof payload.findings === 'number' ? payload.findings : undefined,
    requestId: confirmationId,
    cancelReply: str(payload.cancelReply),
    expiresAt: typeof payload.expiresAt === 'number'
      ? payload.expiresAt
      : typeof payload.expires_at === 'number'
        ? payload.expires_at
        : undefined,
  };
}

type Decision = 'approve' | 'reject' | 'cancel';

const DECISION_LABEL: Record<Decision, string> = {
  approve: '已批准',
  reject: '已拒绝',
  cancel: '已取消',
};

export function ConfirmationCard({ payload, onApprove, onReject, onCancel }: ConfirmationCardProps) {
  const currentUserId = useMatrixStore((s) => s.userId);
  // 带请求 ID 时与收件箱互通：别处（或别的客户端）处理掉，本卡同步只读。
  const resolution = useHitlInboxStore((s) =>
    payload.requestId ? s.resolutions[payload.requestId] : undefined,
  );

  const [expanded, setExpanded] = useState(true);
  const [decision, setDecision] = useState<Decision | null>(null);
  // 发送中 / 未写入房间：撑起「点了不等于已答复」的诚实反馈，失败可重试。
  const [submitting, setSubmitting] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const actionable = Boolean(payload.requestId);
  const settled = decision !== null || resolution?.status === 'answered';
  const expired = resolution?.status === 'expired'
    || (decision === null && resolution?.status !== 'answered' && typeof payload.expiresAt === 'number' && now >= payload.expiresAt);

  // 过期把收件箱条目一起收掉（与 InterventionCard 同一口径），只做一次。
  useEffect(() => {
    if (!expired || resolution || !payload.requestId) return;
    useHitlInboxStore.getState().expireConfirmation(payload.requestId, currentUserId ?? undefined);
  }, [expired, resolution, payload.requestId, currentUserId]);

  // 过期置灰只需要分钟级节拍，不做高频 tick。
  useEffect(() => {
    if (typeof payload.expiresAt !== 'number' || settled) return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [payload.expiresAt, settled]);

  const submit = async (kind: Decision) => {
    const reply = kind === 'approve'
      ? payload.approveReply
      : kind === 'reject'
        ? payload.rejectReply
        : payload.cancelReply;
    if (!reply || submitting || settled || expired) return;
    const answer: ConfirmationAnswerField | undefined = payload.requestId
      ? {
        confirmation_id: payload.requestId,
        answer: kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : 'cancelled',
        tool_name: payload.toolName,
        ...(currentUserId ? { actor: currentUserId } : {}),
      }
      : undefined;
    setSubmitting(true);
    setSendFailed(false);
    // `=== true` 而不是「没报错」：未登录 / 发送失败 / 调用方不回报结果
    // 都算未写入房间，卡片必须留在可重交状态。
    let delivered = false;
    try {
      const result = kind === 'approve'
        ? onApprove(reply, answer)
        : kind === 'reject'
          ? onReject(reply, answer)
          : onCancel?.(reply, answer);
      delivered = (await Promise.resolve(result)) === true;
    } catch {
      delivered = false;
    }
    setSubmitting(false);
    if (!delivered) {
      setSendFailed(true);
      return;
    }
    setDecision(kind);
    if (payload.requestId) {
      useHitlInboxStore.getState().resolveConfirmation(
        payload.requestId,
        currentUserId ?? undefined,
        reply,
      );
    }
  };

  const settledLabel = decision
    ? DECISION_LABEL[decision]
    : resolution?.status === 'expired'
      ? '已超时'
      : resolution?.actor
        ? `已处理 - ${resolution.actor}`
        : '已处理';

  if (settled || expired) {
    const tone = expired && !decision
      ? 'border-l-amber-500 bg-amber-500/5 border-amber-500/30'
      : decision === 'approve'
        ? 'border-l-emerald-500 bg-emerald-500/5 border-emerald-500/30'
        : decision === 'cancel'
          ? 'border-l-sky-500 bg-sky-500/5 border-sky-500/30'
          : 'border-l-red-500 bg-red-500/5 border-red-500/30';
    const textTone = expired && !decision
      ? 'text-amber-600'
      : decision === 'approve'
        ? 'text-emerald-600'
        : decision === 'cancel'
          ? 'text-sky-600'
          : 'text-red-600';
    return (
      <div className={`my-2 rounded-lg border border-l-4 px-3 py-2 text-xs ${tone}`}>
        <span className={textTone}>
          {settledLabel} - {payload.toolName}
        </span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-amber-500/30 border-l-4 border-l-amber-500 bg-amber-500/5 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-500/10 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" />
          工具审批 - {payload.toolName}
          <ApprovalSeverityBadge severity={payload.severity} />
        </span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {payload.triggeredBy && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">触发来源：</span>
              {payload.triggeredBy}
            </div>
          )}
          {payload.riskDetails && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-foreground/70 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                风险详情{typeof payload.findings === 'number' ? `（${payload.findings} 项）` : ''}
              </div>
              <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
                {payload.riskDetails}
              </pre>
            </div>
          )}
          {payload.parameters && (
            <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
              {payload.parameters}
            </pre>
          )}
          {payload.requestId && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">请求 ID：</span>
              <span className="font-mono">{payload.requestId}</span>
            </div>
          )}
          {actionable ? (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={submitting}
                onClick={() => void submit('approve')}
              >
                <Check className="w-3 h-3 mr-1" />
                {submitting ? '提交中…' : '批准本次'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs border-red-300 text-red-600 hover:bg-red-50"
                disabled={submitting}
                onClick={() => void submit('reject')}
              >
                <X className="w-3 h-3 mr-1" />
                拒绝本次
              </Button>
              {payload.cancelReply && onCancel && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  disabled={submitting}
                  onClick={() => void submit('cancel')}
                >
                  <Ban className="w-3 h-3 mr-1" />
                  取消
                </Button>
              )}
              {sendFailed && (
                <span className="text-xs text-red-600">发送失败，请重试</span>
              )}
            </div>
          ) : (
            <div className="pt-1 text-xs text-muted-foreground">
              运行时未提供请求 ID，按钮无法精确绑定本次请求（避免误判其它待审批）。
              可在房间手动发送 <code className="font-mono">{payload.approveReply}</code>。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
