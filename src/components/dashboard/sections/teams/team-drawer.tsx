'use client';

// 团队详情右侧抽屉（Sheet，560px / 窄屏全宽）——薄 chrome 包装：
// Sheet 头（名称 / 阶段 / 就绪概览）+ TeamSettingsPanel（唯一实现，
// 「团队与Agent」页内联详情复用同一面板，F7 单一数据源）。
// 入口：团队表格行点击、卡片「详情」或团队名。

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { Users } from 'lucide-react';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { TeamSettingsPanel } from './team-settings-panel';

export type TeamDrawerProps = {
  team: TeamResponse | null;
  /** 全部团队（判定未归属 Worker 的引用集）。 */
  allTeams?: TeamResponse[];
  workers: WorkerResponse[];
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onOpenChange: (_open: boolean) => void;
  onChanged?: () => void;
  onDeleted?: () => void;
};

/** 关闭时整棵子树不挂载：面板内查询/弹窗不会在列表页空跑。 */
export function TeamDrawer(props: TeamDrawerProps) {
  const { team, allTeams, workers, modelOptions, sessionIssue, userLevel, onOpenChange, onChanged, onDeleted } = props;
  if (!team) return null;
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        data-testid="team-drawer"
        className="w-full gap-0 overflow-x-hidden p-0 sm:w-[560px] sm:max-w-[560px]"
      >
        <SheetHeader>
          <SheetTitle className="flex min-w-0 items-center gap-2">
            <Users className="size-4 shrink-0 text-status-done" aria-hidden="true" />
            <span className="truncate">{team.name}</span>
            <PhaseBadge kind="team" phase={team.phase} className="shrink-0" />
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <StatusDot phase={team.phase} />
            <span className="truncate">{team.teamName || '未设置显示名'}</span>
            <span aria-hidden="true">·</span>
            <span>
              {team.readyWorkers}/{team.totalWorkers} Workers 就绪
            </span>
            {team.leaderName && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">Leader {team.leaderName}</span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>
        <TeamSettingsPanel
          key={team.name}
          team={team}
          allTeams={allTeams}
          workers={workers}
          modelOptions={modelOptions}
          sessionIssue={sessionIssue}
          userLevel={userLevel}
          onChanged={onChanged}
          onDeleted={() => {
            onOpenChange(false);
            onDeleted?.();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
