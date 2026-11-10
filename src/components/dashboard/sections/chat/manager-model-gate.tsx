'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-base';
import { hashForSection } from '@/lib/nav-hash';
import { Button } from '@/components/ui/button';

export function ManagerModelGate({ name, children }: { name: string; children: (_configured: boolean) => ReactNode }) {
  const status = useQuery({
    queryKey: ['manager-model-status', name],
    queryFn: async () => {
      const response = await fetch(apiUrl(`/api/agentteams/managers/${encodeURIComponent(name)}/model-status`));
      // Older Controllers do not expose first-run discovery.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('暂时无法检查模型配置，请稍后重试。');
      return response.json() as Promise<{ configured: boolean; model: string }>;
    },
    refetchInterval: 15_000,
    retry: false,
  });
  const missing = status.data?.configured === false;
  const configure = () => {
    const params = new URLSearchParams({ manager: name, returnTo: window.location.hash.slice(1) || hashForSection('chat') });
    window.location.hash = `${hashForSection('models')}?${params}`;
  };
  return <div className="flex h-full min-h-0 flex-col">
    {missing && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
      <p className="text-sm">配置模型后，就可以开始和 Manager 对话。</p>
      <Button size="sm" onClick={configure}>配置模型</Button>
    </div>}
    {status.isError && <div role="status" className="flex items-center gap-3 border-b px-4 py-2 text-sm text-muted-foreground">
      {status.error.message}<Button variant="ghost" size="sm" onClick={() => void status.refetch()}>重试</Button>
    </div>}
    <div className="min-h-0 flex-1">{children(!missing && !status.isPending)}</div>
  </div>;
}
