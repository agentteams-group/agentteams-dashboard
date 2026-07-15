import { useQuery } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { ConsumerResponse } from '@/lib/agentteams-api';
import { isUnsupportedEndpointError } from '@/lib/api-error';

export function useConsumers() {
  const query = useQuery<ConsumerResponse[]>({
    queryKey: ['agentteams-consumers'],
    queryFn: () => agentteamsApi.listConsumers(),
    refetchInterval: 30000,
    retry: (failureCount, error) =>
      !isUnsupportedEndpointError(error) && failureCount < 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });

  // AgentTeams v1.2.0-beta.1 has no GET /api/v1/gateway/consumers (405):
  // treat the list as empty instead of an error so the UI can show a
  // friendly notice while create/bind/delete keep working.
  const listUnsupported = isUnsupportedEndpointError(query.error);

  return {
    ...query,
    data: listUnsupported ? [] : query.data,
    error: listUnsupported ? null : query.error,
    isError: listUnsupported ? false : query.isError,
    listUnsupported,
  };
}
