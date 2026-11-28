import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useShellPollingInterval } from '@/lib/shell-polling';

export function useAgentTeamsStatus() {
  return useQuery({
    queryKey: ['agentteams-health'],
    queryFn: () => {
      const store = useAgentTeamsStore.getState();
      return agentteamsApi.checkHealth(store.controllerUrl);
    },
    refetchInterval: useShellPollingInterval(['agentteams-health'], 15_000),
    retry: 1,
    placeholderData: 'checking',
    throwOnError: false,
  });
}
