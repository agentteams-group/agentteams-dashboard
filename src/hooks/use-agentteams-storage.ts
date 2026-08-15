import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { BucketResponse, StorageObject } from '@/lib/agentteams-api';

export function useBuckets() {
  return useQuery<BucketResponse[]>({
    queryKey: ['agentteams-buckets'],
    queryFn: () => agentteamsApi.listBuckets(),
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useObjects(bucket: string | null, prefix?: string) {
  return useQuery<StorageObject[]>({
    queryKey: ['agentteams-objects', bucket, prefix],
    queryFn: () => agentteamsApi.listObjects(bucket!, prefix),
    enabled: !!bucket,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useWorkerFiles(workerName: string, prefix?: string) {
  return useQuery<StorageObject[]>({
    queryKey: ['agentteams-worker-files', workerName, prefix ?? ''],
    queryFn: () => agentteamsApi.listWorkerFiles(workerName, prefix || undefined),
    enabled: !!workerName,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useTeamFiles(teamName: string, prefix?: string) {
  return useQuery<StorageObject[]>({
    queryKey: ['agentteams-team-files', teamName, prefix ?? ''],
    queryFn: () => agentteamsApi.listTeamFiles(teamName, prefix || undefined),
    enabled: !!teamName,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useUploadTeamFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ teamName, file, prefix }: { teamName: string; file: File; prefix?: string }) =>
      agentteamsApi.uploadTeamFile(teamName, file, prefix),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agentteams-team-files', variables.teamName],
      });
    },
  });
}

export function useUploadWorkerFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workerName, file, prefix }: { workerName: string; file: File; prefix?: string }) =>
      agentteamsApi.uploadWorkerFile(workerName, file, prefix),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agentteams-worker-files', variables.workerName],
      });
    },
  });
}

export function useDeleteObject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) => agentteamsApi.deleteObject(bucket, key),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agentteams-objects', variables.bucket],
      });
    },
  });
}

export function useDownloadObjectUrl() {
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) => Promise.resolve(agentteamsApi.downloadObjectUrl(bucket, key)),
  });
}

export function useUploadObject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key, file }: { bucket: string; key: string; file: File }) => agentteamsApi.uploadObject(bucket, key, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agentteams-objects', variables.bucket],
      });
    },
  });
}

export function useCreateBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => agentteamsApi.createBucket(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-buckets'] });
    },
  });
}

export function useDeleteBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => agentteamsApi.deleteBucket(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-buckets'] });
    },
  });
}

export function useBucketStats(bucket: string | null) {
  return useQuery<{ bucket: string; objectCount: number; totalSize: number }>({
    queryKey: ['agentteams-bucket-stats', bucket],
    queryFn: () => agentteamsApi.getBucketStats(bucket!),
    enabled: !!bucket,
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
    throwOnError: false,
  });
}

export function useBulkDeleteObjects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, keys }: { bucket: string; keys: string[] }) =>
      agentteamsApi.bulkDeleteObjects(bucket, keys),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-objects', variables.bucket] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-bucket-stats', variables.bucket] });
    },
  });
}

