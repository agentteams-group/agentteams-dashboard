import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-base';

export interface LatestVersionInfo {
  version: string;
  url: string;
}

export interface LatestVersionsResponse {
  agentteams: LatestVersionInfo | null;
  dashboard: LatestVersionInfo | null;
  repositories: {
    agentteams: string;
    dashboard: string;
  };
}

/** Latest upstream GitHub release for AgentTeams and this Dashboard. */
export function useLatestVersions() {
  return useQuery<LatestVersionsResponse>({
    queryKey: ['dashboard-latest-versions'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/dashboard/latest-versions'));
      if (!response.ok) throw new Error('无法获取最新版本信息');
      return response.json();
    },
    // Server-side fetch is cached for 1h; poll gently to pick up new releases.
    refetchInterval: 3_600_000,
    staleTime: 1_800_000,
    retry: 1,
    throwOnError: false,
  });
}
