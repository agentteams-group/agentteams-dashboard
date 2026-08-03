import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';

export function useWorkerSkills(workerName: string | null) {
  return useQuery({
    queryKey: ['agentteams-worker-skills', workerName],
    queryFn: () =>
      workerName
        ? agentteamsApi.listWorkerSkills(workerName).then((r) => r.skills)
        : Promise.resolve([]),
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
    }: {
      workerName: string;
      file: File;
    }) => agentteamsApi.uploadWorkerSkill(workerName, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agentteams-worker-skills', variables.workerName],
      });
    },
  });
}
