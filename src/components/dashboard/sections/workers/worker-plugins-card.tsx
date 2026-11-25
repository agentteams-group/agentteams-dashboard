'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { agentteamsApi, type PluginMetadataEntry } from '@/lib/agentteams-api';
import { ApiError } from '@/lib/api-error';

/** Worker 插件只读表（版本 / 启用状态；不提供安装入口）。 */
export function WorkerPluginsCard({ workerName }: { workerName: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [plugins, setPlugins] = useState<PluginMetadataEntry[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setPlugins(await agentteamsApi.getWorkerPlugins(workerName));
      setState('ready');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setState('unsupported');
        return;
      }
      setState('error');
    }
  }, [workerName]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 p-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        插件信息加载中…
      </div>
    );
  }

  if (state === 'unsupported') {
    return (
      <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
        该 Worker 未提供插件信息。
      </p>
    );
  }

  if (state === 'error') {
    return (
      <p className="p-2.5 text-xs text-muted-foreground">
        插件信息读取失败，稍后重试。
      </p>
    );
  }

  if (plugins.length === 0) {
    return <p className="p-2.5 text-xs text-muted-foreground">未安装 Worker 插件。</p>;
  }

  return (
    <ul className="space-y-1 text-xs">
      {plugins.map((plugin, index) => (
        <li key={plugin.id || plugin.name || index} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate" title={plugin.description}>{plugin.name || plugin.id || '-'}</span>
          <span className="shrink-0 font-mono text-muted-foreground">{plugin.version || '-'}</span>
          <Badge variant={plugin.enabled ? 'secondary' : 'outline'} className="shrink-0 text-xs">
            {plugin.enabled ? '已启用' : '未启用'}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
