// React Query hooks for AI Model management via Higress Console API
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { higressApi } from '@/lib/higress-api';
import type {
  LlmProviderResponse,
  CreateLlmProviderRequest,
  UpdateLlmProviderRequest,
  AiRoute,
  CreateAiRouteRequest,
} from '@/lib/higress-api';

// ============ AI Providers ============

export function useModels() {
  return useQuery<LlmProviderResponse[]>({
    queryKey: ['hiclaw-models'],
    queryFn: () => higressApi.listProviders(),
    refetchInterval: 30000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useCreateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLlmProviderRequest) => higressApi.createProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models'] });
    },
  });
}

export function useUpdateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateLlmProviderRequest }) =>
      higressApi.updateProvider(name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models'] });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => higressApi.deleteProvider(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-models'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-ai-routes'] });
    },
  });
}

// ============ AI Routes ============

export function useAiRoutes() {
  return useQuery<AiRoute[]>({
    queryKey: ['hiclaw-ai-routes'],
    queryFn: () => higressApi.listRoutes(),
    refetchInterval: 30000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export function useCreateAiRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAiRouteRequest) => higressApi.createRoute(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-ai-routes'] });
    },
  });
}

export function useUpdateAiRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<CreateAiRouteRequest> }) =>
      higressApi.updateRoute(name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-ai-routes'] });
    },
  });
}

export function useDeleteAiRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => higressApi.deleteRoute(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-ai-routes'] });
    },
  });
}

// Legacy compatibility — expose ModelResponse shape from LlmProviderResponse
// This keeps ModelSelector and other consumers working without changes
export type { LlmProviderResponse as ModelResponse };
