'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { WorkerResponse } from '@/lib/agentteams-api';
import { WorkerDetailSummary } from './worker-detail-summary';

/**
 * 只读详情弹窗。配置项（运行配置 / 技能 / 审批 / 频道 / 工具 / Coding CLI /
 * LLM 调优…）已迁到可编辑分区面；这里只回答「这个 Worker 是什么」。
 * 正文 = 共享只读组件 WorkerDetailSummary（EntityInspector / 编辑抽屉同源复用）。
 */
export function WorkerDetailDialog({
  worker,
  onOpenChange,
}: {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
}) {
  return (
    <Dialog open={!!worker} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(100%-2rem,40rem)] sm:max-w-[min(100%-2rem,40rem)] max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Worker 详情 - {worker?.name}</DialogTitle>
        </DialogHeader>
        {worker && <WorkerDetailSummary worker={worker} />}
      </DialogContent>
    </Dialog>
  );
}
