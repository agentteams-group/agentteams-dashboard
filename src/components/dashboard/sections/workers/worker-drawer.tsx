'use client';

// Worker 详情右侧抽屉——薄 chrome 包装：Dialog 壳（右侧滑入 560px /
// 窄屏全宽）+ WorkerDetailPanel（唯一实现，「团队与Agent」页内联详情
// 复用同一面板，F7 单一数据源）。
// 入口：Worker 列表行点击。

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { WorkerDetailPanel } from './worker-detail-panel';

type WorkerDrawerProps = {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onChanged?: () => void;
  onDeleted?: () => void;
};

/** 关闭时整棵子树不挂载：抽屉内各面板的 useQuery 不会在列表页空跑。 */
export function WorkerDrawer({ worker, onOpenChange, ...rest }: WorkerDrawerProps) {
  if (!worker) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="left-auto right-0 top-0 h-full max-h-full w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-l p-0 sm:w-[min(92vw,560px)] sm:max-w-[560px] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Worker 详情</DialogTitle>
          <DialogDescription>Worker 详情面板</DialogDescription>
        </DialogHeader>
        <WorkerDetailPanel
          key={worker.name}
          worker={worker}
          onClose={() => onOpenChange(false)}
          {...rest}
        />
      </DialogContent>
    </Dialog>
  );
}
