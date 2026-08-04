// React hook for Agent Health Scoring
import { useMemo } from 'react';
import { computeAgentHealth, type AgentHealthScore } from '@/lib/agent-health';
import type { WorkerResponse } from '@/lib/agentteams-api';

/**
 * Compute health scores for a single worker.
 * Pure computation from cached data — no extra API call needed.
 */
export function useAgentHealth(worker: WorkerResponse | undefined | null): AgentHealthScore | null {
  return useMemo(() => {
    if (!worker) return null;
    return computeAgentHealth(worker);
  }, [worker]);
}


