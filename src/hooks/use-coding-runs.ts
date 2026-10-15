import { useQuery } from '@tanstack/react-query';
import { agentteamsApi, type CodingRun } from '@/lib/agentteams-api';

export function useCodingRuns() {
  return useQuery<CodingRun[]>({
    queryKey: ['agentteams-coding-runs'],
    queryFn: () => agentteamsApi.listCodingRuns(),
    refetchInterval: 30000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}
