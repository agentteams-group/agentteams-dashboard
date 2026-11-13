import { apiUrl } from '@/lib/api-base';
import type { McpServerConfig } from '@/lib/agentteams-api';
import type { McpManagedInput, McpVerification } from '@/lib/mcp-management';

async function request<T>(body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(apiUrl('/api/agentteams/mcps/manage'), { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  return data as T;
}

export const mcpManagementApi = {
  capabilities: () => request<{ available: boolean; gateway: string }>(),
  save: (input: McpManagedInput) => request<McpServerConfig>({ action: 'save', input }),
  verify: (name: string) => request<McpVerification>({ action: 'verify', name }),
  call: (name: string, tool: string, args: Record<string, unknown>) => request<McpVerification>({ action: 'call', name, tool, arguments: args }),
  authorize: (name: string, workers: string[]) => request<{ success: boolean; authorizedWorkers: string[]; pendingRemovalWorkers?: string[]; results: { name: string; success: boolean; message: string }[] }>({ action: 'authorize', name, workers }),
  remove: (name: string) => request<{ success: boolean }>({ action: 'delete', name }),
  importOpenApi: (content: string) => request<{ rawConfig: string; toolCount: number }>({ action: 'import', content }),
};
