import { useQuery } from '@tanstack/react-query';
import { useShellPollingInterval } from '@/lib/shell-polling';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { ClusterStatus } from '@/lib/agentteams-api';

const defaultStatus: ClusterStatus = { kubeMode: false, totalWorkers: 0, totalTeams: 0, totalHumans: 0 };

export function useClusterStatus() {
  return useQuery<ClusterStatus>({
    queryKey: ['agentteams-cluster-status'],
    queryFn: () => agentteamsApi.getStatus(),
    refetchInterval: useShellPollingInterval(['agentteams-cluster-status'], 30_000),
    retry: 1,
    placeholderData: (previousData) => previousData ?? defaultStatus,
    throwOnError: false,
  });
}
