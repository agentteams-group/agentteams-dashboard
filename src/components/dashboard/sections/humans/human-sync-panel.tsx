'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, RefreshCw, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/dashboard/copy-button';
import { agentteamsApi } from '@/lib/agentteams-api';
import { ApiError, formatErrorMessage } from '@/lib/api-error';
import {
  classifyHumanSyncError,
  humanSyncEtagLabel,
  mapHumanSyncStatus,
  type HumanSyncView,
} from '@/lib/human-sync';

function formatTimestamp(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN');
}

async function loadHumanSync(name: string): Promise<HumanSyncView> {
  try {
    const status = await agentteamsApi.getHumanSyncStatus(name);
    let etag: string | null = null;
    try {
      etag = (await agentteamsApi.getHumanSyncManifest(name)).etag;
    } catch (err) {
      // A missing manifest is the normal "nothing synced yet" state; the
      // status summary still decides the view. A real failure propagates.
      if (!(err instanceof ApiError) || classifyHumanSyncError(err.status) === 'error') throw err;
    }
    return mapHumanSyncStatus(status, etag);
  } catch (err) {
    if (err instanceof ApiError) {
      const degradation = classifyHumanSyncError(err.status);
      if (degradation !== 'error') return { kind: 'empty', reason: degradation };
      return { kind: 'error', message: formatErrorMessage(err, '同步状态加载失败') };
    }
    return { kind: 'error', message: formatErrorMessage(err, '同步状态加载失败') };
  }
}

function SyncRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-border/50">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 max-w-[65%] text-right font-mono text-xs break-all">{children}</span>
    </div>
  );
}

/**
 * 「Human 详情 → 同步」read-only section (#1499).
 *
 * Shows the server-owned manifest state: generation, last update, entry count
 * and the manifest ETag. The file-sync client owns the manifest write; the
 * dashboard only reads. A 404/405 (no manifest yet / older Controller) is an
 * empty state, not an error.
 */
export function HumanSyncPanel({ humanName }: { humanName: string }) {
  const { data, isFetching, refetch } = useQuery<HumanSyncView>({
    queryKey: ['agentteams-human-sync', humanName],
    queryFn: () => loadHumanSync(humanName),
    retry: false,
    gcTime: 0,
  });

  return (
    <div className="pt-3" data-testid="human-sync-panel">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-muted-foreground">同步</p>
        <Badge variant="outline" className="text-[10px] h-4 px-1">只读</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          刷新
        </Button>
      </div>

      {!data && (
        <p className="text-xs text-muted-foreground">同步状态加载中…</p>
      )}

      {data?.kind === 'ready' && (
        <div className="text-sm">
          <SyncRow label="代次">{data.generation}</SyncRow>
          <SyncRow label="更新时间">{formatTimestamp(data.updatedAt)}</SyncRow>
          <SyncRow label="条目">
            {data.entries}
            {data.tombstones > 0 ? `（墓碑 ${data.tombstones}）` : ''}
          </SyncRow>
          {data.updatedBy && <SyncRow label="更新者">{data.updatedBy}</SyncRow>}
          <div className="flex justify-between gap-3 py-1 border-b border-border/50">
            <span className="text-muted-foreground shrink-0">Manifest ETag</span>
            <div className="flex items-center gap-1 min-w-0 max-w-[65%]">
              <span className="font-mono text-xs truncate">{humanSyncEtagLabel(data.etag)}</span>
              {data.etag && <CopyButton text={data.etag} />}
            </div>
          </div>
        </div>
      )}

      {data?.kind === 'empty' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCcw className="w-3 h-3 shrink-0" aria-hidden="true" />
          {data.reason === 'unsupported'
            ? '当前 Controller 不支持同步状态接口（405），请升级后再查看'
            : '暂无同步记录（客户端尚未写入 manifest）'}
        </p>
      )}

      {data?.kind === 'error' && (
        <div className="flex items-center gap-2 text-xs text-destructive" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="break-all">{data.message}</span>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>重试</Button>
        </div>
      )}
    </div>
  );
}
