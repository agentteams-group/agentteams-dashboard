'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { EntityInspector, type EntityInspectorEntity } from '../team-agents/entity-inspector';
import { EntitySectionDialogs } from '../team-agents/entity-inspector-sections';
import { drawerDismissGuards } from '../team-agents/drawer-dismiss-guards';

type WorkerDrawerProps = {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  /** 全部团队：解析 Worker 所属团队（Inspector 角色徽标 / 分区弹窗成员口径）。 */
  teams?: TeamResponse[];
  /** 全部 Worker：分区弹窗（WorkerDetailPanel）的成员 / 关联口径。 */
  workers?: WorkerResponse[];
  onChanged?: () => void;
  onDeleted?: () => void;
};

/**
 * 卡片「编辑」抽屉（整改③）：复用 EntityInspector（头部 + 动作 + 分区按钮 +
 * 按钮下方常驻只读详情）；点击分区按钮打开可编辑分区弹窗——
 * 弹窗路由走共享组件 EntitySectionDialogs（与工作台 section 弹窗映射同源，
 * 弹窗内仍是 WorkerDetailPanel 单一实现）。
 * 只读详情与 WorkerDetailDialog 正文同一实现（WorkerDetailSummary，禁复制）。
 * 关闭时整棵子树不挂载：抽屉内 hooks 不在列表页空跑。
 */
export function WorkerDrawer({
  worker,
  onOpenChange,
  modelOptions,
  sessionIssue,
  userLevel,
  teams,
  workers,
  onChanged,
  onDeleted,
}: WorkerDrawerProps) {
  // 分区弹窗状态：worker 切换（重开抽屉）时复位，防止上一次残留。
  const workerName = worker?.name ?? null;
  const [sectionPanel, setSectionPanel] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState(false);
  useEffect(() => {
    setSectionPanel(null);
    setSectionOpen(false);
  }, [workerName]);

  if (!worker) return null;

  const teamList = teams ?? [];
  const workerList = workers ?? [];
  const homeTeam =
    teamList.find((team) => team.name === worker.team || team.teamName === worker.team) ?? null;
  const entity: EntityInspectorEntity = { kind: 'worker', worker, homeTeam };

  const handleSectionOpenChange = (open: boolean) => {
    setSectionOpen(open);
    if (!open) setSectionPanel(null);
  };

  const handleDeleted = () => {
    setSectionOpen(false);
    setSectionPanel(null);
    onOpenChange(false);
    onDeleted?.();
  };

  return (
    <>
      {/* 非模态：与工作台 dual 抽屉同一条规矩（真抽屉 + 分区弹窗同时在场；
          modal 会让 Radix 把兄弟节点的分区弹窗 aria-hidden 掉，弹窗不可交互）。 */}
      <Dialog open modal={false} onOpenChange={onOpenChange}>
        <DialogContent
          className="left-auto right-0 top-0 h-full max-h-full w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-l p-0 sm:w-[min(92vw,560px)] sm:max-w-[560px] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
          showCloseButton={false}
          {...drawerDismissGuards(sectionOpen)}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Worker 详情</DialogTitle>
            <DialogDescription>Worker 详情面板</DialogDescription>
          </DialogHeader>
          <EntityInspector
            entity={entity}
            workers={workerList}
            userLevel={userLevel}
            onOpenSection={(panel) => {
              setSectionPanel(panel);
              setSectionOpen(true);
            }}
            onChanged={onChanged}
            onDeleted={handleDeleted}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
      <EntitySectionDialogs
        entity={sectionOpen ? entity : null}
        open={sectionOpen}
        initialTab={sectionPanel ?? undefined}
        chrome="section"
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        allTeams={teamList}
        workers={workerList}
        onOpenChange={handleSectionOpenChange}
        onChanged={onChanged}
        onDeleted={handleDeleted}
      />
    </>
  );
}
