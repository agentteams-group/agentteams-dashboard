import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { WorkerResponse } from '@/lib/agentteams-api';

export function useWorkers() {
  return useQuery<WorkerResponse[]>({
    queryKey: ['agentteams-workers'],
    queryFn: () => agentteamsApi.listWorkerSummaries(),
    refetchInterval: 15000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}
