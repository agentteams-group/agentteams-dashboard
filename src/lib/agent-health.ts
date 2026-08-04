// Agent Health Scoring System
// Computes a composite 0-100 health score from WorkerResponse fields

import type { WorkerResponse, WorkerPhase } from '@/lib/agentteams-api';

export interface AgentHealthScore {
  overall: number;        // 0-100 composite
  availability: number;   // 0-100 based on phase
  stability: number;      // 0-100 based on container state
  readiness: number;      // 0-100 based on message/state
  trend: 'healthy' | 'degraded' | 'critical';
  label: string;
}

// Phase → availability score
const PHASE_SCORES: Record<string, number> = {
  Running: 100,
  Ready: 100,
  Sleeping: 70,
  Pending: 40,
  Updating: 50,
  Stopped: 20,
  Failed: 0,
};

// Container state → stability score
const CONTAINER_STATE_SCORES: Record<string, number> = {
  running: 100,
  created: 60,
  restarting: 30,
  removing: 10,
  paused: 40,
  exited: 10,
  dead: 0,
};

function scorePhase(phase: WorkerPhase): number {
  return PHASE_SCORES[phase] ?? 50;
}

function scoreContainerState(containerState: string | undefined): number {
  if (!containerState) return 80; // No container management = assumed OK
  return CONTAINER_STATE_SCORES[containerState.toLowerCase()] ?? 60;
}

function scoreReadiness(worker: WorkerResponse): number {
  // Failed with a message = explicit failure
  if (worker.phase === 'Failed' && worker.message) return 0;
  // Has a Matrix user ID and room = well-configured
  if (worker.matrixUserID && worker.roomID) return 100;
  // Has at least one of them
  if (worker.matrixUserID || worker.roomID) return 70;
  // No Matrix integration
  return 50;
}

function computeTrend(overall: number): AgentHealthScore['trend'] {
  if (overall >= 70) return 'healthy';
  if (overall >= 40) return 'degraded';
  return 'critical';
}

function trendLabel(trend: AgentHealthScore['trend']): string {
  switch (trend) {
    case 'healthy': return '健康';
    case 'degraded': return '降级';
    case 'critical': return '异常';
  }
}

export function computeAgentHealth(worker: WorkerResponse): AgentHealthScore {
  const availability = scorePhase(worker.phase);
  const stability = scoreContainerState(worker.containerState);
  const readiness = scoreReadiness(worker);

  // Weighted average: availability 50%, stability 30%, readiness 20%
  const overall = Math.round(availability * 0.5 + stability * 0.3 + readiness * 0.2);
  const trend = computeTrend(overall);

  return {
    overall,
    availability,
    stability,
    readiness,
    trend,
    label: trendLabel(trend),
  };
}

/** Get the stroke color for the SVG ring */
export function healthScoreStrokeColor(score: number): string {
  if (score >= 80) return '#10b981'; // emerald-500
  if (score >= 60) return '#22c55e'; // green-500
  if (score >= 40) return '#f59e0b'; // amber-500
  return '#ef4444'; // red-500
}
