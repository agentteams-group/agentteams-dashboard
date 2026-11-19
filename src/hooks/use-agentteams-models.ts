import { apiUrl } from '@/lib/api-base';
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

const providerQueryKey = ['agentteams-models'];
const routeQueryKey = ['agentteams-ai-routes'];
const bindingQueryKey = ['agentteams-model-bindings'];

function invalidateProviderDependencies(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: providerQueryKey });
  queryClient.invalidateQueries({ queryKey: routeQueryKey });
  queryClient.invalidateQueries({ queryKey: bindingQueryKey });
}

function invalidateRouteDependencies(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: routeQueryKey });
  queryClient.invalidateQueries({ queryKey: bindingQueryKey });
}

// ============ AI Providers ============

export function useModels(enabled = true) {
  return useQuery<LlmProviderResponse[]>({
    queryKey: providerQueryKey,
    queryFn: () => higressApi.listProviders(),
    enabled,
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
      invalidateProviderDependencies(queryClient);
    },
  });
}

export function useUpdateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateLlmProviderRequest }) =>
      higressApi.updateProvider(name, data),
    onSuccess: () => {
      invalidateProviderDependencies(queryClient);
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => higressApi.deleteProvider(name),
    onSuccess: () => {
      invalidateProviderDependencies(queryClient);
    },
  });
}

// ============ SGLang serving models ============

export interface SglangModelsResponse {
  enabled: boolean;
  models: string[];
  error?: string;
}

const sglangQueryKey = ['agentteams-sglang-models'];

// SGLang serving layer for model selection. The server route returns an empty
// list when AGENTTEAMS_SGLANG_URL is unset or unreachable, so deployments
// without a local inference server are unaffected. The serving model list only
// changes when SGLang itself restarts, so a slow refetch is deliberate.
export function useSglangModels(enabled = true) {
  return useQuery<SglangModelsResponse>({
    queryKey: sglangQueryKey,
    queryFn: async () => {
      const res = await fetch(apiUrl('/api/agentteams/sglang-models'), { cache: 'no-store' });
      if (!res.ok) return { enabled: true, models: [] };
      return (await res.json()) as SglangModelsResponse;
    },
    enabled,
    refetchInterval: 60000,
    retry: 1,
    throwOnError: false,
  });
}

// ============ AI Routes ============

export function useAiRoutes(enabled = true) {
  return useQuery<AiRoute[]>({
    queryKey: routeQueryKey,
    queryFn: () => higressApi.listRoutes(),
    enabled,
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
      invalidateRouteDependencies(queryClient);
    },
  });
}

export function useUpdateAiRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<CreateAiRouteRequest> }) =>
      higressApi.updateRoute(name, data),
    onSuccess: () => {
      invalidateRouteDependencies(queryClient);
    },
  });
}

export function useDeleteAiRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => higressApi.deleteRoute(name),
    onSuccess: () => {
      invalidateRouteDependencies(queryClient);
    },
  });
}
