import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-base';

export interface DashboardRuntimeInfo {
  repository: string;
  version: string;
  uptimeSeconds: number;
  startedAt: string;
}

export function useDashboardRuntime() {
  return useQuery<DashboardRuntimeInfo>({
    queryKey: ['dashboard-runtime'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/dashboard/runtime'));
      if (!response.ok) throw new Error('无法获取 Dashboard 运行信息');
      return response.json();
    },
    refetchInterval: 60_000,
    retry: 1,
    throwOnError: false,
  });
}
