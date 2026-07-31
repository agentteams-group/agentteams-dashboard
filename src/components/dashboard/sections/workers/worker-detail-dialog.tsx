'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { HealthRing } from '@/components/dashboard/health-ring';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { useAgentMetrics } from '@/hooks/use-agent-metrics';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { WorkerResponse, LogLine } from '@/lib/agentteams-api';
import { useEffect, useState } from 'react';
import { agentteamsApi } from '@/lib/agentteams-api';
import { WorkerTimeline } from './worker-timeline';
import { MetricChart } from './metric-chart';

const DETAIL_FIELDS: Array<[string, (_w: WorkerResponse) => string]> = [
  ['名称', (w) => w.name],
  ['状态', (w) => w.state],
  ['运行时', (w) => RUNTIME_LABELS[w.runtime] || w.runtime],
  ['模型', (w) => w.model || '-'],
  ['镜像', (w) => w.image || '-'],
  ['团队', (w) => w.team || '-'],
  ['角色', (w) => w.role || '-'],
  ['关联 Agents', (w) => w.agents || '-'],
  ['Matrix 用户', (w) => w.matrixUserID || '-'],
  ['房间 ID', (w) => w.roomID || '-'],
  ['容器管理', (w) => (w.containerManaged ? '是' : '否')],
  ['容器状态', (w) => w.containerState || '-'],
  ['消息', (w) => w.message || '-'],
];

export function WorkerDetailDialog({
  worker,
  onOpenChange,
}: {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
}) {
  return (
    <Dialog open={!!worker} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Worker 详情 - {worker?.name}</DialogTitle>
        </DialogHeader>
        {worker && (
          <div className="space-y-3 py-4 text-sm">
            <div className="flex items-center gap-2 mb-3">
              <StatusDot phase={worker.phase} />
              <PhaseBadge kind="worker" phase={worker.phase} />
              <RuntimeBadge runtime={worker.runtime} />
            </div>
            <WorkerHealthBreakdown worker={worker} />
            
              {/* Tabs for Details, Logs, Timeline, and Resource Usage */}
              <div className="mt-4">
                <div className="border-b border-border/50 flex gap-4">
                  <button
                    className="py-2 text-sm font-medium hover:text-emerald-500 transition-colors border-b-2 border-emerald-500 text-emerald-500"
                  >
                    详情
                  </button>
                  <button
                    className="py-2 text-sm font-medium text-muted-foreground hover:text-emerald-500 transition-colors border-b-2 border-transparent"
                  >
                    日志
                  </button>
                  <button
                    className="py-2 text-sm font-medium text-muted-foreground hover:text-emerald-500 transition-colors border-b-2 border-transparent"
                  >
                    时间线
                  </button>
                  <button
                    className="py-2 text-sm font-medium text-muted-foreground hover:text-emerald-500 transition-colors border-b-2 border-transparent"
                  >
                    资源使用
                  </button>
                </div>

                {/* Resource Usage Tab Content */}
                <WorkerResourceUsage worker={worker} />
              
              {/* Details Tab Content */}
              <div className="mt-3">
                {DETAIL_FIELDS.map(([label, read]) => (
                  <div
                    key={label}
                    className="flex justify-between py-1 border-b border-border/50"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-xs max-w-[60%] text-right break-all">
                      {read(worker)}
                    </span>
                  </div>
                ))}
                {(worker.mcpServers?.length ?? 0) > 0 && (
                  <div className="pt-2">
                    <p className="text-muted-foreground mb-1">MCP Servers</p>
                    {worker.mcpServers?.map((s, i) => (
                      <div key={i} className="text-xs font-mono flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground">({s.transport})</span>
                        <span className="truncate">{s.url}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(worker.exposedPorts?.length ?? 0) > 0 && (
                  <div className="pt-2">
                    <p className="text-muted-foreground mb-1">暴露端口</p>
                    {worker.exposedPorts?.map((p, i) => (
                      <div key={i} className="text-xs font-mono">
                        {p.port} → {p.domain}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Logs Tab Content */}
              <div className="mt-3">
                <WorkerLogViewer _workerName={worker.name} />
              </div>

              {/* Timeline Tab Content */}
              <div className="mt-3">
                <WorkerTimeline worker={worker} />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkerLogViewer({ _workerName }: { _workerName: string }) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        // Get logs for this worker - use worker name as component identifier
        const result = await agentteamsApi.getLogs(_workerName, { tail: 50 });
        setLogs(result);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch worker logs:', err);
        // Try alternative log endpoint format
        try {
          const result = await agentteamsApi.getLogs(`workers/${_workerName}`, { tail: 50 });
          setLogs(result);
          setError(null);
        } catch {
          setError('无法获取日志，请检查 Worker 状态');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [_workerName]);

  if (loading) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground bg-background rounded p-4 border border-border/50">
        暂无日志记录
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto bg-background rounded p-2 border border-border/50 font-mono text-xs">
      {logs.map((log, index) => (
        <div key={index} className={`py-1 border-b border-border/10 ${
          log.level === 'error' ? 'text-red-500' : log.level === 'warning' ? 'text-amber-500' : ''
        }`}>
          <span className="text-gray-400 mr-2">{log.timestamp}</span>
          <span className="text-gray-500 mr-2 w-16 inline-block">{log.level}</span>
          <span className="text-gray-400 mr-2 w-32 inline-block">{log.component}</span>
          {log.message}
        </div>
      ))}
    </div>
  );
}

function WorkerHealthBreakdown({ worker }: { worker: WorkerResponse }) {
  const health = useAgentHealth(worker);
  if (!health) return null;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
      <HealthRing score={health.overall} size={56} strokeWidth={4} label={health.label} />
      <div className="flex-1 space-y-1.5">
        <HealthBar label="可用性" value={health.availability} />
        <HealthBar label="稳定性" value={health.stability} />
        <HealthBar label="就绪度" value={health.readiness} />
      </div>
    </div>
  );
}

function HealthBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[10px] font-mono w-6 text-right">{value}</span>
    </div>
  );
}

function WorkerResourceUsage({ worker }: { worker: WorkerResponse }) {
  const { data, isLoading, error } = useAgentMetrics({ name: worker.name });

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center justify-center py-8 text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (error) {
    console.warn('[WorkerResourceUsage] Metrics unavailable:', error);
    return (
      <div className="mt-3 text-center py-8 text-sm text-muted-foreground bg-muted/30 rounded border border-border/50">
        暂无可用数据
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <MetricChart data={data?.data ?? []} height={180} showMemory />
      {data && data.data.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="p-2 rounded bg-muted/30 border border-border/50">
            <p className="text-muted-foreground">当前 CPU</p>
            <p className="font-mono font-semibold">
              {Math.round(data.data[data.data.length - 1]?.cpu ?? 0)}%
            </p>
          </div>
          <div className="p-2 rounded bg-muted/30 border border-border/50">
            <p className="text-muted-foreground">当前内存</p>
            <p className="font-mono font-semibold">
              {(data.data[data.data.length - 1]?.memory ?? 0 / 1e9).toFixed(1)} GB
            </p>
          </div>
          <div className="p-2 rounded bg-muted/30 border border-border/50">
            <p className="text-muted-foreground">采样间隔</p>
            <p className="font-mono font-semibold">过去 1 小时</p>
          </div>
        </div>
      )}
    </div>
  );
}
