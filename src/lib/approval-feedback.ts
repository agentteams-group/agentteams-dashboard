export const APPROVAL_FEEDBACK_MARKER = '【审批意见】';

export function buildApprovalFeedback(context: {
  toolName: string; parameters?: string; riskDetails?: string;
  severity?: string; triggeredBy?: string; sourceEventId?: string;
}, decision: 'approve' | 'reject' | 'cancel', comment: string): string {
  const verdict = { approve: '同意本次操作', reject: '拒绝本次操作', cancel: '取消本次操作' }[decision];
  return [
    APPROVAL_FEEDBACK_MARKER,
    `审批意见：${verdict}`,
    ...(comment.trim() ? [`补充意见：${comment.trim()}`] : []),
    `原审批工具：${context.toolName}`,
    ...(context.severity ? [`风险等级：${context.severity}`] : []),
    ...(context.triggeredBy ? [`触发来源：${context.triggeredBy}`] : []),
    ...(context.parameters ? [`原审批参数：\n${context.parameters}`] : []),
    ...(context.riskDetails ? [`原审批风险说明：\n${context.riskDetails}`] : []),
    ...(context.sourceEventId ? [`原审批消息：${context.sourceEventId}`] : []),
    '请核对以上原审批内容后处理，意见仅适用于此操作。',
  ].join('\n\n');
}
