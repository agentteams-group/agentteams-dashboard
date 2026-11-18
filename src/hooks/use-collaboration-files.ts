import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCollaborationFiles, uploadCollaborationFile, type CollaborationFileScope } from '@/lib/collaboration-files';

export function useCollaborationFiles(scope: CollaborationFileScope | undefined, prefix: string) {
  return useQuery({
    queryKey: ['collaboration-files', scope, prefix],
    queryFn: () => listCollaborationFiles(scope!, prefix),
    enabled: !!scope,
    retry: false,
  });
}

export function useUploadCollaborationFile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ team, file, prefix }: { team: string; file: File; prefix: string }) => uploadCollaborationFile(team, file, prefix),
    onSuccess: (_, { team }) => client.invalidateQueries({ queryKey: ['collaboration-files', { team }] }),
  });
}
