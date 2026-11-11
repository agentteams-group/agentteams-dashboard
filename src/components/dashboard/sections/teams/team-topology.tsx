'use client';

import { Bot, Crown, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { getWorkersForTeam } from './team-selectors';

/**
 * 旧「查看拓扑」弹窗里的静态图（兼容 #console/resources 资源容器）。
 *
 * Leader 语义修正：`TeamResponse.leaderName` 是 Worker 名，只在 Worker 列表里
 * 解析；`team.admin` 才是 Manager。新「团队与Agent」页不使用本组件，改用
 * `sections/team-agents/interactive-team-topology`。
 */
export function TeamTopologyDiagram({
  team,
  workers,
}: {
  team: TeamResponse;
  workers: WorkerResponse[];
}) {
  const teamWorkers = getWorkersForTeam(workers, team.name);
  const leader = workers.find((worker) => worker.name === team.leaderName) ?? null;

  return (
    <div className="flex flex-col items-center gap-0 py-4">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-purple-500/40 bg-purple-500/10 shadow-sm">
        <StatusDot phase={leader?.phase ?? team.phase} />
        <Crown className="w-4 h-4 text-purple-500" aria-hidden="true" />
        <span className="text-sm font-medium">{team.leaderName || '未指定'}</span>
        <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-600 dark:text-purple-400">
          Leader
        </Badge>
      </div>
      <div className="w-0.5 h-6 bg-purple-500/30" />
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 shadow-sm">
        <StatusDot phase={team.phase} />
        <Users className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <span className="text-sm font-medium">{team.name}</span>
        <PhaseBadge kind="team" phase={team.phase} />
        {team.admin?.name && (
          <Badge variant="outline" className="text-xs">
            Manager {team.admin.name}
          </Badge>
        )}
      </div>
      {teamWorkers.length > 0 && (
        <>
          <div className="w-0.5 h-6 bg-emerald-500/30" />
          <div className="relative flex items-start justify-center gap-3 flex-wrap">
            {teamWorkers.length > 1 && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] h-0.5 bg-emerald-500/20 max-w-[400px]" />
            )}
            {teamWorkers.map((w) => (
              <div key={w.name} className="flex flex-col items-center">
                <div className="w-0.5 h-4 bg-emerald-500/20" />
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                  <StatusDot phase={w.phase} />
                  <Bot className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                  <span className="text-xs font-medium">{w.name}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {teamWorkers.length === 0 && (
        <p className="text-xs text-muted-foreground mt-2">暂无 Worker</p>
      )}
    </div>
  );
}
