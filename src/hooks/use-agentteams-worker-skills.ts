import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { agentteamsApi } from '@/lib/agentteams-api';
import { useWorkers } from './use-agentteams-workers';

export function useWorkerSkills(workerName: string | null) {
  const { data: workers = [] } = useWorkers();
  const runtimeByName = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const w of workers) map[w.name] = w.runtime;
    return map;
  }, [workers]);

  return useQuery({
    queryKey: ['agentteams-worker-skills', workerName, runtimeByName[workerName ?? ''] ?? 'unknown'],
    queryFn: () => {
      if (!workerName) return Promise.resolve([] as string[]);
      const runtime = runtimeByName[workerName];
      const promise = runtime
        ? agentteamsApi.listWorkerSkills(workerName, runtime)
        : agentteamsApi.listWorkerSkills(workerName);
      return promise.then((r) => r.skills);
    },
    enabled: !!workerName,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useUploadWorkerSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workerName,
      file,
      runtime,
    }: {
      workerName: string;
      file: File;
      runtime?: string | null;
    }) => agentteamsApi.uploadWorkerSkill(workerName, file, runtime),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agentteams-worker-skills', variables.workerName],
      });
    },
  });
}
