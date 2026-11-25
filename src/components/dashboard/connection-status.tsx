'use client';

import { useState } from 'react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ConnectionStatus({ isConnected, versionString, mode }: { isConnected: boolean; versionString?: string; mode?: string | null }) {
  const [open, setOpen] = useState(false);
  const latency = useAgentTeamsStore((s) => s.connectionLatency);
  const error = useAgentTeamsStore((s) => s.connectionError);
  const matrixLoggedIn = useMatrixStore((s) => s.isLoggedIn);
  const matrixSyncing = useMatrixStore((s) => s.isSyncing);
  const { data, isError, isFetching } = useInfrastructure({ enabled: open });
  const rows: [string, boolean | undefined][] = [
    ['Controller', isConnected],
    ['Matrix 服务', data?.matrix?.healthy],
    ['模型网关', data?.higress?.healthy],
    ['文件存储', data?.minio?.healthy],
    ...(mode === 'k8s' && data?.kubernetes ? [['Kubernetes', data.kubernetes.healthy] as [string, boolean]] : []),
  ];

  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild>
      <button type="button" aria-label="连接状态" className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${isConnected ? 'bg-status-done' : 'bg-status-waiting'}`} />
        <span className="hidden sm:inline">{isConnected ? '已连接' : '未连接'}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="bottom" align="end" className="w-64 border border-border bg-popover p-4 text-popover-foreground shadow-lg">
      <div className="mb-3 flex items-center justify-between text-xs">
        <span>Controller 延迟</span>
        <span className="text-muted-foreground">{latency == null ? '延迟暂不可用' : `${latency} ms`}</span>
      </div>
      <dl className="space-y-2 text-xs">
        {rows.map(([name, healthy]) => <div key={name} className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className={healthy === false ? 'text-status-waiting' : ''}>{healthy === undefined ? '未知' : healthy ? '正常' : '检查异常'}</dd>
        </div>)}
        <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">消息同步</dt><dd>{!matrixLoggedIn ? '未连接' : matrixSyncing ? '同步中' : '已连接'}</dd></div>
      </dl>
      {isFetching && !data && <p className="mt-3 text-xs text-muted-foreground">正在检查组件状态…</p>}
      {isError && <p className="mt-3 text-xs text-status-waiting">组件状态暂时无法读取</p>}
      {error && !isConnected && <p className="mt-3 text-xs text-status-waiting">{error}</p>}
      {versionString && <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Core {versionString}</p>}
    </TooltipContent>
  </Tooltip>;
}
