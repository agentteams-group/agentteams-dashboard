'use client';

// 团队「运行状态与房间信息」共享块（单一数据源）：TeamSettingsPanel 基本信息 tab
// 的「运行状态与房间信息」分区与右栏 Inspector（选中团队时实体头之下）共用，
// 运行状态、房间与健康度使用相同的数据口径。
//
// 阶段（StatusDot + PhaseBadge）/ Leader（mono）/ Workers（就绪/总数）/
// 团队房间（mono + 复制 teamRoomID）/
// 健康度（健康标签 + 就绪率 X% · 成员健康 N，口径 computeTeamAnalytics）。
//
// 复制按钮复用 CopyButton：触控断点下 ≥44px 命中区由 ui/button.tsx 的触控外框
// 约定保证（min-h-11 min-w-11 → sm:min-h-0 sm:min-w-0）。

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/dashboard/copy-button';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { computeTeamAnalytics } from '@/lib/team-analytics';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-xs">{children}</span>
    </div>
  );
}

export interface TeamStatusSummaryProps {
  team: TeamResponse;
  /** 全部 Worker 列表：成员健康口径（无数据时传 []，就绪率仍按团队字段计算）。 */
  workers: WorkerResponse[];
}

export function TeamStatusSummary({ team, workers }: TeamStatusSummaryProps) {
  const analytics = useMemo(() => computeTeamAnalytics(team, workers), [team, workers]);
  return (
    <div className="space-y-1 rounded-md bg-muted/20 p-2">
      <SummaryRow label="阶段">
        <span className="flex items-center gap-1.5">
          <StatusDot phase={team.phase} />
          <PhaseBadge kind="team" phase={team.phase} />
        </span>
      </SummaryRow>
      <SummaryRow label="Leader">
        <span className="font-mono">{team.leaderName || '-'}</span>
      </SummaryRow>
      <SummaryRow label="Workers">
        <span>
          {team.readyWorkers}/{team.totalWorkers} 就绪
        </span>
      </SummaryRow>
      <SummaryRow label="团队房间">
        {team.teamRoomID ? (
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono">{team.teamRoomID}</span>
            <CopyButton text={team.teamRoomID} label="复制团队房间 ID" className="shrink-0" />
          </span>
        ) : (
          '-'
        )}
      </SummaryRow>

      <SummaryRow label="健康度">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={analytics.trend === 'critical' ? 'destructive' : analytics.trend === 'healthy' ? 'secondary' : 'outline'}
            className="text-xs"
          >
            {analytics.label}
          </Badge>
          <span className="text-muted-foreground">
            就绪率 {analytics.readinessPct}% · 成员健康 {analytics.healthScore}
          </span>
        </span>
      </SummaryRow>
    </div>
  );
}
