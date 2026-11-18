'use client';

import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { DetailDialogShell } from './detail-dialog-shell';
import { TeamDetailSummary } from './team-detail-summary';

/**
 * 团队只读详情弹窗（详情 ≠ 编辑的承载方）。
 *
 * - 「详情」按钮 → 本弹窗：只读（TeamDetailSummary 单一实现，无输入框、无保存）；
 * - 「编辑」按钮 → TeamDetailDialog（可编辑分区弹窗）。
 *
 * 壳复用 DetailDialogShell（与 Worker/Manager 详情的尺寸、关闭按钮、滚动链一致）。
 */
export function TeamDetailReadonlyDialog({
  open,
  onOpenChange,
  team,
  workers,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  team: TeamResponse | null;
  workers: WorkerResponse[];
}) {
  if (!team) return null;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`团队详情 - ${team.teamName || team.name}`}
      description="团队运行状态与成员（只读）"
      bodyClassName="overflow-y-auto"
    >
      <TeamDetailSummary team={team} workers={workers} />
    </DetailDialogShell>
  );
}
