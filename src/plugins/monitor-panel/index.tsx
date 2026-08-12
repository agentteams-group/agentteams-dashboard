'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw, Server, Users, Bot, UserCheck } from 'lucide-react';
import type { DashboardPluginApi } from '@/lib/plugins/types';

/**
 * Example plugin: cluster monitoring panel.
 *
 * Demonstrates the three most common extension points:
 *   - sidebar-menu : a "监控面板" entry below the built-in navigation
 *   - route        : a standalone page rendered in the dashboard shell
 *   - dashboard-widget : a compact card on the overview page
 *
 * All data is fetched through the plugin API (api.dashboard.*), never by
 * importing Dashboard internals — exactly how a third-party plugin works.
 */

interface ClusterStatusSnapshot {
  totalWorkers: number;
  totalTeams: number;
  totalHumans: number;
  kubeMode: boolean;
}

interface VersionSnapshot {
  controller?: string;
  dashboard?: string;
}

interface WorkerRow {
  name: string;
  phase?: string;
}

function isClusterStatus(value: unknown): value is ClusterStatusSnapshot {
  return typeof value === 'object' && value !== null && 'totalWorkers' in value;
}

// ────────────────────────────────────────────
// Standalone page (extension point: route)
// ────────────────────────────────────────────

function createMonitorPage(api: DashboardPluginApi) {
  return function MonitorPage() {
    const [status, setStatus] = useState<ClusterStatusSnapshot | null>(null);
    const [version, setVersion] = useState<VersionSnapshot | null>(null);
    const [workers, setWorkers] = useState<WorkerRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const [rawStatus, rawVersion, rawWorkers] = await Promise.all([
          api.dashboard.getClusterStatus(),
          api.dashboard.getVersion(),
          api.dashboard.listWorkers(),
        ]);
        if (isClusterStatus(rawStatus)) setStatus(rawStatus);
        setVersion((rawVersion as VersionSnapshot) ?? null);
        setWorkers(Array.isArray(rawWorkers) ? (rawWorkers as WorkerRow[]) : []);
        api.events.emit('monitor-panel:refreshed', { at: Date.now() });
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      void refresh();
    }, [refresh]);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">集群监控</h2>
            <Badge variant="outline" className="text-xs">
              示例插件
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            数据加载失败：{error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            icon={<Bot className="w-4 h-4" />}
            label="Workers"
            value={status ? String(status.totalWorkers) : '--'}
          />
          <StatCard
            icon={<Users className="w-4 h-4" />}
            label="团队"
            value={status ? String(status.totalTeams) : '--'}
          />
          <StatCard
            icon={<UserCheck className="w-4 h-4" />}
            label="Humans"
            value={status ? String(status.totalHumans) : '--'}
          />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">运行环境</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">部署模式</span>
              <span>{status ? (status.kubeMode ? 'Kubernetes' : 'Embedded') : '--'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Controller 版本</span>
              <span className="font-mono text-xs">{version?.controller ?? '--'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Worker 状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            {workers.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无 Worker 数据</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(
                  workers.reduce<Record<string, number>>((acc, w) => {
                    const key = w.phase ?? 'Unknown';
                    acc[key] = (acc[key] ?? 0) + 1;
                    return acc;
                  }, {})
                ).map(([phase, count]) => (
                  <Badge key={phase} variant="secondary" className="text-xs">
                    {phase}: {count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold leading-tight">{value}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Server className="w-3 h-3" />
            {label}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────
// Overview widget (extension point: dashboard-widget)
// ────────────────────────────────────────────

function createHealthWidget(api: DashboardPluginApi) {
  return function ClusterHealthWidget() {
    const [status, setStatus] = useState<ClusterStatusSnapshot | null>(null);

    useEffect(() => {
      let cancelled = false;
      api.dashboard
        .getClusterStatus()
        .then((raw) => {
          if (!cancelled && isClusterStatus(raw)) setStatus(raw);
        })
        .catch(() => {
          /* widget must never crash the overview page */
        });
      return () => {
        cancelled = true;
      };
    }, []);

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-primary" />
            集群健康概览
            <Badge variant="outline" className="text-[10px] ml-auto">
              插件
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {status ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xl font-bold">{status.totalWorkers}</div>
                <div className="text-xs text-muted-foreground">Workers</div>
              </div>
              <div>
                <div className="text-xl font-bold">{status.totalTeams}</div>
                <div className="text-xs text-muted-foreground">团队</div>
              </div>
              <div>
                <div className="text-xl font-bold">{status.totalHumans}</div>
                <div className="text-xs text-muted-foreground">Humans</div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">加载中…</p>
          )}
        </CardContent>
      </Card>
    );
  };
}

// ────────────────────────────────────────────
// Plugin lifecycle
// ────────────────────────────────────────────

const unregisterFns: Array<() => void> = [];

export function activate(api: DashboardPluginApi): void {
  const MonitorPage = createMonitorPage(api);
  const ClusterHealthWidget = createHealthWidget(api);

  unregisterFns.push(
    api.registerRoute({
      id: 'monitor',
      title: '监控面板',
      component: MonitorPage,
    })
  );

  unregisterFns.push(
    api.registerMenuItem({
      id: 'monitor',
      label: '监控面板',
      icon: 'activity',
      target: { type: 'plugin-route', routeId: 'monitor' },
    })
  );

  unregisterFns.push(
    api.registerWidget({
      id: 'cluster-health',
      title: '集群健康概览',
      component: ClusterHealthWidget,
      size: 'md',
    })
  );

  api.log.info('监控面板插件已激活');
}

export function deactivate(): void {
  while (unregisterFns.length > 0) {
    const fn = unregisterFns.pop();
    fn?.();
  }
}

const monitorPanelPlugin = { activate, deactivate };

export default monitorPanelPlugin;
