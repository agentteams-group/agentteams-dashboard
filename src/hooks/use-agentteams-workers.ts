import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { WorkerResponse } from '@/lib/agentteams-api';
import { useShellPollingInterval } from '@/lib/shell-polling';

export function useWorkers() {
  return useQuery<WorkerResponse[]>({
    queryKey: ['agentteams-workers'],
    queryFn: () => agentteamsApi.listWorkerSummaries(),
    refetchInterval: useShellPollingInterval(['agentteams-workers'], 60_000),
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}
