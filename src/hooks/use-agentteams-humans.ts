import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import type { HumanResponse } from '@/lib/agentteams-api';

export function useHumans() {
  const userLevel = useAgentTeamsStore((state) => state.userLevel);
  return useQuery<HumanResponse[]>({
    enabled: userLevel >= 3,
    queryKey: ['agentteams-humans'],
    queryFn: () => agentteamsApi.listHumans(),
    refetchInterval: 15000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}
