import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hiclawApi } from '@/lib/hiclaw-api';
import type { ModelResponse, CreateModelRequest, UpdateModelRequest } from '@/lib/hiclaw-api';

export function useModels() {
  return useQuery<ModelResponse[]>({
    queryKey: ['hiclaw-models'],
    queryFn: () => hiclawApi.listModels(),
    refetchInterval: 30000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useDefaultModel() {
  return useQuery<ModelResponse | null>({
    queryKey: ['hiclaw-models-default'],
    queryFn: () => hiclawApi.getDefaultModel(),
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useCreateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateModelRequest) => hiclawApi.createModel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models-default'] });
    },
  });
}

export function useUpdateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateModelRequest }) =>
      hiclawApi.updateModel(name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models-default'] });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => hiclawApi.deleteModel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models-default'] });
    },
  });
}

export function useSetDefaultModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => hiclawApi.setDefaultModel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models-default'] });
    },
  });
}
