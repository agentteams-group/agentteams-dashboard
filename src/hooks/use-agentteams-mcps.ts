import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { McpServerConfig, McpTestResult } from '@/lib/agentteams-api';

export function useMcpServers(): UseQueryResult<McpServerConfig[], Error> {
  return useQuery<McpServerConfig[], Error>({
    queryKey: ['agentteams-mcps'],
    queryFn: async () => {
      const data = await agentteamsApi.listMcpServers();
      return data.servers;
    },
    placeholderData: [] as McpServerConfig[],
    throwOnError: false,
  });
}

export function useMcpServer(name: string) {
  return useQuery<McpServerConfig | null>({
    queryKey: ['agentteams-mcp', name],
    queryFn: () => agentteamsApi.getMcpServer(name).catch(() => null),
    enabled: !!name,
    placeholderData: null,
    throwOnError: false,
  });
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; url: string; transport: string; type?: string; timeout?: number; headers?: Record<string, string>; description?: string }) =>
      agentteamsApi.createMcpServer(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-mcps'] });
    },
  });
}

export function useUpdateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: { url?: string; transport?: string; type?: string; timeout?: number; headers?: Record<string, string>; description?: string } }) =>
      agentteamsApi.updateMcpServer(name, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-mcps'] });
    },
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => agentteamsApi.deleteMcpServer(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-mcps'] });
    },
  });
}

export function useTestMcpServer() {
  return useMutation({
    mutationFn: (data: { url: string; transport: string; timeout?: number }) =>
      agentteamsApi.testMcpServer(data),
  });
}
