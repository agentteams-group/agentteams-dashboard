import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { ManagerResponse } from '@/lib/agentteams-api';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useShellPollingInterval } from '@/lib/shell-polling';

export function useManagers() {
  const userLevel = useAgentTeamsStore((state) => state.userLevel);
  return useQuery<ManagerResponse[]>({
    enabled: userLevel >= 3,
    queryKey: ['agentteams-managers'],
    queryFn: () => agentteamsApi.listManagers(),
    refetchInterval: useShellPollingInterval(['agentteams-managers'], 60_000),
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}
