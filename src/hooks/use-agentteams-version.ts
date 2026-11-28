import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { VersionInfo } from '@/lib/agentteams-api';
import { useShellPollingInterval } from '@/lib/shell-polling';

export function useVersion() {
  return useQuery<VersionInfo | null>({
    queryKey: ['agentteams-version'],
    queryFn: () => agentteamsApi.getVersion(),
    refetchInterval: useShellPollingInterval(['agentteams-version'], 300_000),
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}
