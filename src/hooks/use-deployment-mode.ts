'use client';

import { useQuery } from '@tanstack/react-query';
import { useVersion } from './use-hiclaw-version';
import { useClusterStatus } from './use-hiclaw-cluster-status';
import { apiUrl } from '@/lib/api-base';
import type { DeploymentMode } from '@/components/dashboard/nav-items';

interface ModeResponse {
  mode: DeploymentMode;
  source: 'controller' | 'filesystem' | 'env';
}

async function fetchMode(): Promise<ModeResponse> {
  const res = await fetch(apiUrl('/api/hiclaw/mode'));
  if (!res.ok) throw new Error('Failed to fetch deployment mode');
  return res.json();
}

export function useDeploymentMode() {
  const { data: version, isLoading: versionLoading } = useVersion();
  const { data: clusterStatus, isLoading: clusterLoading } = useClusterStatus();

  const controllerKubeMode = version?.kubeMode ?? clusterStatus?.kubeMode;

  const { data: fallbackMode, isLoading: fallbackLoading } = useQuery<ModeResponse>({
    queryKey: ['hiclaw-mode'],
    queryFn: fetchMode,
    // Only consult filesystem fallback when controller hasn't returned a value yet.
    enabled: controllerKubeMode === undefined,
    refetchInterval: false,
    retry: 1,
    throwOnError: false,
  });

  const isLoading = versionLoading || clusterLoading || (controllerKubeMode === undefined && fallbackLoading);

  if (controllerKubeMode !== undefined) {
    const mode = controllerKubeMode ? 'k8s' : 'embedded';
    return { mode, isKube: controllerKubeMode, isEmbedded: !controllerKubeMode, isLoading } as const;
  }

  if (fallbackMode) {
    const mode = fallbackMode.mode;
    return { mode, isKube: mode === 'k8s', isEmbedded: mode === 'embedded', isLoading } as const;
  }

  return { mode: null, isKube: false, isEmbedded: false, isLoading } as const;
}
