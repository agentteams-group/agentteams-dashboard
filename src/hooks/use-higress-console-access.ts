import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-base';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';

interface SessionResponse {
  authenticated: boolean;
}

async function getConsoleSession(): Promise<SessionResponse> {
  const response = await fetch(apiUrl('/api/auth/session'), { credentials: 'same-origin' });
  if (!response.ok) return { authenticated: false };
  return response.json();
}

export function useHigressConsoleAccess() {
  const { data: infrastructure, isLoading: infrastructureLoading } = useInfrastructure();
  const session = useQuery({
    queryKey: ['higress-console-session'],
    queryFn: getConsoleSession,
    refetchInterval: 30_000,
    retry: false,
    throwOnError: false,
  });
  const consoleStatus = infrastructure?.higress?.console;
  const canManage = consoleStatus?.state === 'reachable' && session.data?.authenticated === true;

  let reason: string | undefined;
  if (consoleStatus?.state === 'unconfigured') {
    reason = '部署尚未配置 Higress Console 地址。';
  } else if (consoleStatus?.state === 'unreachable') {
    reason = 'Higress Console 当前不可访问。';
  } else if (!session.isLoading && !session.data?.authenticated) {
    reason = 'Higress Console 会话已失效，请重新登录。';
  }

  return {
    canManage,
    isLoading: infrastructureLoading || session.isLoading,
    reason,
  };
}
