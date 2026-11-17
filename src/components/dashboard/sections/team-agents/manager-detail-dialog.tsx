'use client';

import type { ManagerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { ManagerDetailPanel } from '../managers/manager-detail-panel';
import { DetailDialogShell } from './detail-dialog-shell';

/**
 * Manager 详情大弹窗：承载当前 main 版 ManagerDetailPanel（只按现有签名
 * 嵌入，不改面板内部行为）。面板根为普通 flex-col（无内滚），由弹窗 body
 * 提供 overflow-y-auto。编辑入口（onEdit）沿用 #233 口径：工作台不传，
 * Manager 列表页（managers-section）自带编辑抽屉。
 */
export function ManagerDetailDialog({
  open,
  onOpenChange,
  manager,
  modelOptions,
  sessionIssue,
  userLevel,
  onDm,
  onChanged,
  initialTab,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  manager: ManagerResponse | null;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onDm?: (_mxid: string, _roomId?: string) => void;
  onChanged?: () => void;
  /** 初始 tab（默认 basic，行为不变）；A3 Inspector 分区直达。 */
  initialTab?: string;
}) {
  if (!manager) return null;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Manager · ${manager.name}`}
      description="Manager 运行状态与配置详情"
    >
      <ManagerDetailPanel
        key={manager.name}
        manager={manager}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onDm={onDm}
        onChanged={onChanged}
        initialTab={initialTab}
      />
    </DetailDialogShell>
  );
}
