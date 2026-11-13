import { statusBadgeClass, type StatusToken } from './status-tokens';

/**
 * 工具护栏审批的风险等级展示口径（#235）。
 *
 * 等级词由运行时生成（QwenPaw tool_guard 发送 CRITICAL / HIGH / MEDIUM /
 * LOW / INFO），Dashboard 只按词归色展示：不推断、不升级、不补默认值。
 * 识别不了的词返回 undefined，调用方不渲染徽标，保持克制。
 */
export type ApprovalSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

const SEVERITY_TOKEN: Record<ApprovalSeverity, StatusToken> = {
  CRITICAL: 'blocked',
  HIGH: 'blocked',
  MEDIUM: 'waiting',
  LOW: 'done',
  INFO: 'info',
};

/** 归一化运行时等级词；WARNING 归并 MEDIUM（同一档关注度）。 */
export function normalizeApprovalSeverity(raw: string | undefined): ApprovalSeverity | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  if (upper === 'WARNING' || upper === 'WARN') return 'MEDIUM';
  return upper in SEVERITY_TOKEN ? (upper as ApprovalSeverity) : undefined;
}

/** 徽标类：与全站状态徽章共用同一套 token 色（globals.css 单点定义）。 */
export function approvalSeverityBadgeClass(severity: ApprovalSeverity): string {
  return statusBadgeClass(SEVERITY_TOKEN[severity]);
}
