import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { NacosConfig } from '@/lib/skill-center-types';

export function useNacosConfig() {
  return useQuery<NacosConfig | null>({
    queryKey: ['agentteams-nacos-config'],
    queryFn: () => agentteamsApi.getNacosConfig(),
    throwOnError: false,
  });
}

export function useUpdateNacosConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: NacosConfig) => agentteamsApi.updateNacosConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-nacos-config'] });
    },
  });
}

export function useNacosSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => agentteamsApi.syncNacosSkills(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-nacos-config'] });
      qc.invalidateQueries({ queryKey: ['agentteams-skills'] });
    },
  });
}
