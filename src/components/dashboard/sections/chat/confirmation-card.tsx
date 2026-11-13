'use client';

import { useEffect, useState } from 'react';
import { Shield, Check, X, ArrowUpRight, Ban, AlertTriangle, Clock, Terminal, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
  runtimeApproval?: boolean;
  resolutionKey?: string;
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
    ...(payload.runtimeApproval === true ? { runtimeApproval: true } : {}),
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
  const resolutionKey = payload.resolutionKey ?? payload.requestId;
  const awaitsReceipt = payload.runtimeApproval === true || /^\/approval\s/.test(payload.approveReply);
  // 带请求 ID 时与收件箱互通：别处（或别的客户端）处理掉，本卡同步只读。
  const resolution = useHitlInboxStore((s) =>
    resolutionKey ? s.resolutions[resolutionKey] : undefined,
  );

  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  // 发送中 / 未写入房间：撑起「点了不等于已答复」的诚实反馈，失败可重试。
  const [submitting, setSubmitting] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const actionable = Boolean(payload.requestId) || !/^\/approval\s/.test(payload.approveReply);
  const settled = decision !== null || resolution?.status === 'answered' || resolution?.status === 'submitted';
  const expired = resolution?.status === 'expired'
    || (resolution?.status !== 'answered' && typeof payload.expiresAt === 'number' && now >= payload.expiresAt);

  // 过期把收件箱条目一起收掉（与 InterventionCard 同一口径），只做一次。
  useEffect(() => {
    if (awaitsReceipt || !expired || resolution?.status === 'expired' || resolution?.status === 'answered' || !resolutionKey) return;
    useHitlInboxStore.getState().expireConfirmation(resolutionKey, currentUserId ?? undefined);
  }, [awaitsReceipt, expired, resolution, resolutionKey, currentUserId]);

  // 过期置灰只需要分钟级节拍，不做高频 tick。
  useEffect(() => {
    if (typeof payload.expiresAt !== 'number' || resolution?.status === 'answered') return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [payload.expiresAt, resolution?.status]);

  const submit = async (kind: Decision) => {
    const reply = kind === 'approve'
      ? payload.approveReply
      : kind === 'reject'
        ? payload.rejectReply
        : payload.cancelReply;
    if (!reply || submitting || settled || expired || (typeof payload.expiresAt === 'number' && Date.now() >= payload.expiresAt)) return;
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
    if (resolutionKey) {
      const settle = awaitsReceipt
        ? useHitlInboxStore.getState().submitConfirmation
        : useHitlInboxStore.getState().resolveConfirmation;
      settle(
        resolutionKey,
        currentUserId ?? undefined,
        reply,
      );
    }
  };

  const settledLabel = expired ? '已超时'
    : resolution?.status === 'answered' && awaitsReceipt
      ? ({ approved: '已批准', rejected: '已拒绝', cancelled: '已取消' }[resolution.answer ?? ''] ?? '已处理')
    : awaitsReceipt && (decision || resolution?.status === 'submitted')
      ? '已提交，等待运行时确认'
    : decision ? DECISION_LABEL[decision]
    : resolution?.status === 'expired'
      ? '已超时'
      : resolution?.actor
        ? `已处理 - ${resolution.actor}`
        : '已处理';

  let command = payload.parameters;
  let directory: string | undefined;
  try {
    const parameters = JSON.parse(payload.parameters ?? '{}');
    command = typeof parameters.command === 'string' ? parameters.command : payload.parameters;
    directory = typeof parameters.cwd === 'string' ? parameters.cwd : undefined;
  } catch { /* Plain-text tool parameters remain readable. */ }
  const outcome = resolution?.status === 'answered' && awaitsReceipt
    ? resolution.answer
    : decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'cancel' ? 'cancelled' : undefined;
  const waiting = !expired && settled && (resolution?.status === 'submitted' || (awaitsReceipt && resolution?.status !== 'answered'));
  const Icon = expired ? Clock : waiting ? Loader2 : outcome === 'approved' ? Check : outcome === 'rejected' ? X : Ban;
  const outcomeTone = expired ? 'text-amber-600' : waiting ? 'text-muted-foreground' : outcome === 'approved' ? 'text-emerald-600 dark:text-emerald-400' : outcome === 'rejected' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';

  if (settled || expired) {
    return (
      <div role="status" className="my-2 flex w-full max-w-2xl items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full bg-muted ${outcomeTone}`}>
          <Icon className={`size-4 ${waiting ? 'animate-spin' : ''}`} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${outcomeTone}`}>{settledLabel} - {payload.toolName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{waiting ? '正在等待 Agent 确认，请稍候' : outcome === 'approved' ? '已允许本次操作，执行进展见后续回复' : outcome === 'rejected' ? '本次操作未获允许' : expired ? '此请求已不可操作' : '此请求已处理'}</p>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="my-2 w-full max-w-2xl overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-start gap-3 px-4 pt-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400"><Shield className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">需要你的批准</h3><ApprovalSeverityBadge severity={payload.severity} /></div>
            <p className="mt-1 text-xs text-muted-foreground">{payload.toolName} · 操作正在等待你的决定</p>
          </div>
        </div>
        {command && <pre className="mx-4 mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-xs leading-relaxed">{command}</pre>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
          <p className="text-xs text-muted-foreground">授权仅对本次操作生效</p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>查看并处理<ArrowUpRight className="ml-1.5 size-3.5" aria-hidden="true" /></Button>
        </div>
      </div>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-6 pb-5 pt-6">
          <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"><Shield className="size-5" aria-hidden="true" /></span>
          <DialogTitle>允许执行这项操作？</DialogTitle>
          <DialogDescription>确认具体操作后再授权。拒绝不会执行本次操作。</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55dvh] space-y-4 overflow-y-auto border-y bg-muted/20 px-6 py-5">
          <div className="flex items-center gap-2 text-xs font-medium"><Terminal className="size-3.5" aria-hidden="true" />{payload.toolName}<ApprovalSeverityBadge severity={payload.severity} /></div>
          {command && <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed">{command}</pre>}
          {directory && <div><p className="mb-1 text-xs font-medium">工作目录</p><p className="break-all font-mono text-xs text-muted-foreground">{directory}</p></div>}
          {payload.riskDetails && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"><p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"><AlertTriangle className="size-3.5" aria-hidden="true" />为什么需要批准</p><p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{payload.riskDetails}</p></div>}
          {payload.triggeredBy && <p className="text-xs text-muted-foreground">触发来源：{payload.triggeredBy}</p>}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer hover:text-foreground">请求详情</summary><dl className="mt-2 space-y-2 break-all"><div>请求 ID：{payload.requestId ?? '未提供'}</div>{payload.parameters && <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{payload.parameters}</pre>}</dl></details>
          {!actionable && <p role="alert" className="text-xs text-amber-700">运行时未提供请求 ID，无法精确绑定本次请求。请让 Agent 重新发起审批。</p>}
          {sendFailed && <p role="alert" className="text-xs text-red-600">发送失败，请重试</p>}
        </div>
        <DialogFooter className="items-center bg-card px-6 py-4">
          <span className="mr-auto text-xs text-muted-foreground">仅此操作 · 不更改长期权限</span>
          {payload.cancelReply && onCancel && <Button size="sm" variant="ghost" disabled={submitting || !actionable} onClick={() => void submit('cancel')}>取消</Button>}
          <Button size="sm" variant="outline" disabled={submitting || !actionable} onClick={() => void submit('reject')}><X className="mr-1.5 size-3.5" />拒绝本次</Button>
          <Button size="sm" disabled={submitting || !actionable} onClick={() => void submit('approve')}><Check className="mr-1.5 size-3.5" />{submitting ? '提交中…' : '批准本次'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
