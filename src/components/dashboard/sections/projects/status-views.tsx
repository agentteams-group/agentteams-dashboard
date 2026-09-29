'use client';

import { Badge } from '@/components/ui/badge';
import { CircleAlert } from 'lucide-react';
import { PROJECT_STATUS_COLOR } from '@/lib/status-colors';
import { PROJECT_STATUS_LABEL } from './workflow-config';
import type { ProjectStatus } from '@/lib/agentteams-projects-api';

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={`text-[10px] gap-1 border ${PROJECT_STATUS_COLOR[status] ?? PROJECT_STATUS_COLOR.unknown}`}>
      {PROJECT_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

// ----- Degraded banner (consumes degradedReason from the proxy) -----

export function DegradedBanner({
  degraded,
  degradedReason,
  error,
}: {
  degraded?: boolean;
  degradedReason?: 'api-not-deployed' | 'controller-error';
  error?: string;
}) {
  if (!degraded) return null;
  const message =
    degradedReason === 'controller-error'
      ? 'Controller 端点存在但调用失败（可能 MinIO 不可达）'
      : 'Controller 项目 API 不可用（Controller 未升级到含项目 API 的版本）';
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
      <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">项目 API 降级</p>
        <p className="text-xs opacity-80">{message}</p>
        {error && <p className="text-xs opacity-60 mt-1 font-mono">{error}</p>}
      </div>
    </div>
  );
}
