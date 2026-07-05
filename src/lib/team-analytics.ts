// Team Readiness & Composition Analysis
// Computes team-level health and readiness metrics

import type { TeamResponse, WorkerResponse } from '@/lib/hiclaw-api';
import { computeAgentHealth } from '@/lib/agent-health';

export interface TeamAnalytics {
  readinessPct: number;       // 0-100: readyWorkers/totalWorkers
  healthScore: number;        // 0-100: average of member health scores
  memberHealth: Map<string, number>; // worker name → health score
  runtimeDistribution: Record<string, number>;
  phaseDistribution: Record<string, number>;
  criticalWorkers: string[];  // workers with health < 40
  trend: 'healthy' | 'degraded' | 'critical';
  label: string;
}

export function computeTeamAnalytics(
  team: TeamResponse,
  allWorkers: WorkerResponse[]
): TeamAnalytics {
  // Find workers belonging to this team
  const teamWorkers = allWorkers.filter((w) => w.team === team.teamName || w.team === team.name);

  // Compute health for each member
  const memberHealth = new Map<string, number>();
  let totalHealth = 0;
  const criticalWorkers: string[] = [];
  const runtimeDist: Record<string, number> = {};
  const phaseDist: Record<string, number> = {};

  for (const w of teamWorkers) {
    const health = computeAgentHealth(w);
    memberHealth.set(w.name, health.overall);
    totalHealth += health.overall;

    if (health.overall < 40) criticalWorkers.push(w.name);

    runtimeDist[w.runtime] = (runtimeDist[w.runtime] || 0) + 1;
    phaseDist[w.phase] = (phaseDist[w.phase] || 0) + 1;
  }

  const avgHealth = teamWorkers.length > 0 ? Math.round(totalHealth / teamWorkers.length) : 0;
  const readinessPct = team.totalWorkers > 0
    ? Math.round((team.readyWorkers / team.totalWorkers) * 100)
    : 0;

  // Combined score: 60% readiness + 40% health
  const combinedScore = Math.round(readinessPct * 0.6 + avgHealth * 0.4);

  const trend = combinedScore >= 70 ? 'healthy' : combinedScore >= 40 ? 'degraded' : 'critical';
  const label = trend === 'healthy' ? '健康' : trend === 'degraded' ? '降级' : '异常';

  return {
    readinessPct,
    healthScore: avgHealth,
    memberHealth,
    runtimeDistribution: runtimeDist,
    phaseDistribution: phaseDist,
    criticalWorkers,
    trend,
    label,
  };
}
