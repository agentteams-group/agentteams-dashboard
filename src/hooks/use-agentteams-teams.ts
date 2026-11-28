import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { TeamResponse } from '@/lib/agentteams-api';
import { useShellPollingInterval } from '@/lib/shell-polling';

export function useTeams() {
  return useQuery<TeamResponse[]>({
    queryKey: ['agentteams-teams'],
    queryFn: () => agentteamsApi.listTeams(),
    refetchInterval: useShellPollingInterval(['agentteams-teams'], 60_000),
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}
