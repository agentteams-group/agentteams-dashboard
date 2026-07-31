// useAgentMetrics Hook
// Fetches CPU/memory/network metrics for a given worker or team entity.

import { useQuery, UseQueryResult } from '@tanstack/react-query';
import type { MetricResponse } from '@/lib/agentteams-api';
import { apiUrl } from '@/lib/api-base';

const QUERY_KEY = ['metrics'] as const;

interface UseAgentMetricsOptions {
  name: string;
  entity?: 'worker' | 'team';
  hours?: number;
  intervalMinutes?: number;
  /** Whether to poll the endpoint periodically (default: 60s) */
  refreshIntervalMs?: number;
}

export function useAgentMetrics({
  name,
  entity = 'worker',
  hours = 1,
  intervalMinutes = 1,
  refreshIntervalMs = 60_000,
}: UseAgentMetricsOptions): UseQueryResult<MetricResponse, Error> {
  return useQuery<MetricResponse, Error>({
    queryKey: [...QUERY_KEY, entity, name, hours, intervalMinutes],
    queryFn: async () => {
      const params = new URLSearchParams({ entity, hours: String(hours), interval: String(intervalMinutes) });
      const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(name)}/metrics?${params}`));
      if (!res.ok) throw new Error(`Failed to fetch metrics: ${res.status}`);
      return res.json() as Promise<MetricResponse>;
    },
    staleTime: 30_000,
    refetchInterval: refreshIntervalMs,
    enabled: !!name,
    placeholderData: (prev) => prev,
  });
}
