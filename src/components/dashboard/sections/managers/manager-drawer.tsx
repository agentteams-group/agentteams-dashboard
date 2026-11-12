'use client';

// Manager 详情右侧抽屉——薄 chrome 包装：Sheet 壳（560px / 窄屏全宽，自带关闭键）
// + ManagerDetailPanel（唯一实现，「团队与Agent」页内联详情复用同一面板，F7 单一数据源）。
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { ManagerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';

import { ManagerDetailPanel } from './manager-detail-panel';

export type ManagerDrawerProps = {
  manager: ManagerResponse | null;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  /** Dashboard 会话等级：3 = 管理员（插件侧 L1）才能编辑。 */
  userLevel: number;
  onOpenChange: (_open: boolean) => void;
  onEdit?: (_manager: ManagerResponse) => void;
  onChanged?: () => void;
  onDm?: (_mxid: string, _roomId?: string) => void;
};

/** 关闭时整棵子树不挂载（详情查询不在列表页空跑）。 */
export function ManagerDrawer({ manager, onOpenChange, ...rest }: ManagerDrawerProps) {
  if (!manager) return null;
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent data-testid="manager-drawer" className="w-full gap-0 overflow-x-hidden p-0 sm:w-[560px] sm:max-w-[560px]">
        <SheetHeader className="sr-only">
          <SheetTitle>Manager 详情</SheetTitle>
          <SheetDescription>Manager 详情面板</SheetDescription>
        </SheetHeader>
        <ManagerDetailPanel key={manager.name} manager={manager} {...rest} />
      </SheetContent>
    </Sheet>
  );
}
