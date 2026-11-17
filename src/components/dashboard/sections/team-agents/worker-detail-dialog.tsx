'use client';

import type { WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { WorkerDetailPanel } from '../workers/worker-detail-panel';
import { DetailDialogShell } from './detail-dialog-shell';

/**
 * Agent 详情大弹窗：承载当前 main 版 WorkerDetailPanel（只按现有签名嵌入，
 * 不改面板内部行为）。面板根为普通 flex-col（无内滚），由弹窗 body 提供
 * overflow-y-auto；面板自带 sticky 头部在 body 滚动容器内吸顶。
 */
export function WorkerDetailDialog({
  open,
  onOpenChange,
  worker,
  modelOptions,
  sessionIssue,
  userLevel,
  onDm,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  worker: WorkerResponse | null;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onDm?: (_mxid: string, _roomId?: string) => void;
  onChanged?: () => void;
  /** 面板内删除 Worker 成功后：关弹窗并清选中。 */
  onDeleted?: () => void;
}) {
  if (!worker) return null;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Agent · ${worker.name}`}
      description="Agent 运行状态与配置详情"
    >
      <WorkerDetailPanel
        key={worker.name}
        worker={worker}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onClose={() => onOpenChange(false)}
        onDm={onDm}
        onChanged={onChanged}
        onDeleted={onDeleted}
      />
    </DetailDialogShell>
  );
}
