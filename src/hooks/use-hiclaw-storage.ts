import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hiclawApi } from '@/lib/hiclaw-api';
import type { BucketResponse, StorageObject } from '@/lib/hiclaw-api';

export function useBuckets() {
  return useQuery<BucketResponse[]>({
    queryKey: ['hiclaw-buckets'],
    queryFn: () => hiclawApi.listBuckets(),
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useObjects(bucket: string | null, prefix?: string) {
  return useQuery<StorageObject[]>({
    queryKey: ['hiclaw-objects', bucket, prefix],
    queryFn: () => hiclawApi.listObjects(bucket!, prefix),
    enabled: !!bucket,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useDeleteObject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) => hiclawApi.deleteObject(bucket, key),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['hiclaw-objects', variables.bucket],
      });
    },
  });
}

export function useDownloadObjectUrl() {
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) => Promise.resolve(hiclawApi.downloadObjectUrl(bucket, key)),
  });
}

export function useUploadObject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key, file }: { bucket: string; key: string; file: File }) => hiclawApi.uploadObject(bucket, key, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['hiclaw-objects', variables.bucket],
      });
    },
  });
}

export function useCreateBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetch(`/api/hiclaw/storage/buckets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed: ${res.status}`);
        }
        return res.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-buckets'] });
    },
  });
}

export function useDeleteBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetch(`/api/hiclaw/storage/buckets/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }).then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed: ${res.status}`);
        }
        return res.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-buckets'] });
    },
  });
}

// Presigned URL variants kept for advanced use-cases; the UI uses the proxied
// download/upload helpers above so the browser never needs direct MinIO access.
export function usePresignDownload() {
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) => hiclawApi.presignDownload(bucket, key),
  });
}

export function usePresignUpload() {
  return useMutation({
    mutationFn: ({ bucket, key, contentType }: { bucket: string; key: string; contentType?: string }) => hiclawApi.presignUpload(bucket, key, contentType),
  });
}
