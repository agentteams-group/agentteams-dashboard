import { AlertTriangle, CheckCircle2, Clock, Pause, Activity, Zap } from 'lucide-react';
import type { WorkerResponse } from '@/lib/agentteams-api';
import { countByPhase, getHealthDistributionStatic, getAverageHealthScore } from './worker-selectors';

export function WorkerStatsBar({ workers }: { workers: WorkerResponse[] | undefined }) {
  if (!workers || workers.length === 0) return null;

  const phases = countByPhase(workers);
  const healthDist = getHealthDistributionStatic(workers);
  const avgScore = getAverageHealthScore(workers);

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <span className="text-[11px] font-mono font-bold text-muted-foreground mr-1">
        总计: {workers.length}
      </span>

      {/* Phase mini indicators */}
      <span className="flex items-center gap-1 text-[10px]">
        <Activity className="w-3 h-3 text-emerald-500" />
        <span className="text-emerald-500 font-medium">{phases.Running + phases.Ready}</span>
      </span>

      {phases.Sleeping > 0 && (
        <span className="flex items-center gap-1 text-[10px]">
          <Pause className="w-3 h-3 text-blue-500" />
          <span className="text-blue-500 font-medium">{phases.Sleeping}</span>
        </span>
      )}

      {phases.Pending > 0 && (
        <span className="flex items-center gap-1 text-[10px]">
          <Clock className="w-3 h-3 text-amber-500" />
          <span className="text-amber-500 font-medium">{phases.Pending}</span>
        </span>
      )}

      {phases.Failed > 0 && (
        <span className="flex items-center gap-1 text-[10px]">
          <AlertTriangle className="w-3 h-3 text-red-500" />
          <span className="text-red-500 font-medium">{phases.Failed}</span>
        </span>
      )}

      {/* Divider */}
      <span className="text-border/50 mx-1">|</span>

      {/* Health breakdown */}
      <span className="flex items-center gap-1 text-[10px]">
        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
        <span className="text-emerald-500 font-medium">{healthDist.healthy}</span>
      </span>

      {healthDist.degraded > 0 && (
        <span className="flex items-center gap-1 text-[10px]">
          <AlertTriangle className="w-3 h-3 text-amber-500" />
          <span className="text-amber-500 font-medium">{healthDist.degraded}</span>
        </span>
      )}

      {healthDist.critical > 0 && (
        <span className="flex items-center gap-1 text-[10px]">
          <AlertTriangle className="w-3 h-3 text-red-500" />
          <span className="text-red-500 font-medium">{healthDist.critical}</span>
        </span>
      )}

      {/* Divider */}
      {avgScore !== null && (
        <>
          <span className="text-border/50 mx-1">|</span>
          <span className="flex items-center gap-1 text-[10px]">
            <Zap className="w-3 h-3 text-violet-500" />
            <span className="text-violet-500 font-medium">平均健康: {avgScore}</span>
          </span>
        </>
      )}
    </div>
  );
}