/**
 * HITL 审计上报（PRD F2.4）：干预生命周期事件（request/answer/expire）
 * 经 BFF 落服务端审计 JSONL。fire-and-forget：失败静默（审计缺失不阻塞
 * 交互；服务端 BFF 会用 session 身份归因）。
 */

export interface HitlAuditInput {
  action: 'request' | 'answer' | 'expire';
  confirmationId: string;
  roomId?: string;
  toolName?: string;
  question?: string;
  /** 所选答案（hitl.answer）。 */
  answer?: string;
  /** 从请求到答复/超时的耗时毫秒。 */
  elapsedMs?: number;
  /** 会话身份不可用时兜底（Matrix MXID）。 */
  actor?: string;
}

export function recordHitlAudit(input: HitlAuditInput): void {
  void fetch('/api/agentteams/hitl/audit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: input.action,
      confirmation_id: input.confirmationId,
      ...(input.roomId ? { room_id: input.roomId } : {}),
      ...(input.toolName ? { tool_name: input.toolName } : {}),
      ...(input.question ? { question: input.question } : {}),
      ...(input.answer ? { answer: input.answer } : {}),
      ...(typeof input.elapsedMs === 'number' ? { elapsed_ms: input.elapsedMs } : {}),
      ...(input.actor ? { actor: input.actor } : {}),
    }),
  }).catch(() => undefined);
}
