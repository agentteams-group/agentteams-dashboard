import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-base';

interface SessionResponse {
  authenticated: boolean;
  level?: number;
}

async function getControllerSession(): Promise<SessionResponse> {
  const response = await fetch(apiUrl('/api/auth/session'), { credentials: 'same-origin' });
  if (!response.ok) return { authenticated: false };
  return response.json();
}

export function useHigressConsoleAccess() {
  const session = useQuery({
    queryKey: ['higress-console-session'],
    queryFn: getControllerSession,
    refetchInterval: 30_000,
    retry: false,
    throwOnError: false,
  });
  const canManage = session.data?.authenticated === true && session.data.level === 3;
  const reason = session.isLoading ? undefined
    : !session.data?.authenticated ? '请先登录后再使用模型管理。'
    : !canManage ? '模型网关管理需要 L1 管理员权限。' : undefined;
  return { canManage, isLoading: session.isLoading, reason };
}
