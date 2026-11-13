'use client';

import { Badge } from '@/components/ui/badge';
import { approvalSeverityBadgeClass, normalizeApprovalSeverity } from '@/lib/approval-severity';

/**
 * 工具审批风险等级徽标（#235）。
 * 等级词由运行时生成；识别不了的词不渲染徽标，不猜默认值。
 */
export function ApprovalSeverityBadge({ severity }: { severity: string | undefined }) {
  const normalized = normalizeApprovalSeverity(severity);
  if (!normalized) return null;
  return (
    <Badge
      variant="outline"
      className={`h-4 shrink-0 px-1.5 text-xs ${approvalSeverityBadgeClass(normalized)}`}
    >
      {normalized}
    </Badge>
  );
}
