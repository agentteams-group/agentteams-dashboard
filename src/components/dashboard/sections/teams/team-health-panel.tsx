'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { HealthRing, HealthRingCompact } from '@/components/dashboard/health-ring';
import { computeTeamAnalytics } from '@/lib/team-analytics';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

export function TeamHealthPanel({
  team,
  allWorkers,
}: {
  team: TeamResponse;
  allWorkers: WorkerResponse[];
}) {
  const analytics = useMemo(() => computeTeamAnalytics(team, allWorkers), [team, allWorkers]);

  return (
    <div className="space-y-4 p-4 bg-muted/20 rounded-lg border border-border/50">
      {/* Header with overall score */}
      <div className="flex items-center gap-4">
        <HealthRing score={analytics.healthScore} size={64} strokeWidth={5} label={analytics.label} />
        <div className="flex-1 space-y-1">
          <h4 className="text-sm font-semibold">团队健康度</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">就绪率</span>
            <Progress value={analytics.readinessPct} className="h-1.5 flex-1" />
            <span className="text-[10px] font-mono">{analytics.readinessPct}%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {team.readyWorkers}/{team.totalWorkers} Workers 就绪
          </p>
        </div>
      </div>

      {/* Critical workers warning */}
      {analytics.criticalWorkers.length > 0 && (
        <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-red-500">异常 Workers</p>
            <p className="text-[10px] text-muted-foreground">
              {analytics.criticalWorkers.join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Member health grid */}
      {analytics.memberHealth.size > 0 && (
        <div>
          <p className="text-xs font-medium mb-2">成员健康</p>
          <div className="grid grid-cols-2 gap-2">
            {Array.from(analytics.memberHealth.entries()).map(([name, score]) => (
              <div key={name} className="flex items-center gap-2 p-1.5 rounded bg-background/50">
                <HealthRingCompact score={score} size={20} />
                <span className="text-[10px] truncate">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Runtime distribution */}
      {Object.keys(analytics.runtimeDistribution).length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1.5">运行时分布</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(analytics.runtimeDistribution).map(([runtime, count]) => (
              <Badge key={runtime} variant="secondary" className="text-[10px]">
                {RUNTIME_LABELS[runtime] || runtime}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
