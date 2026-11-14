'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';
import type { DashboardPluginApi } from '@/lib/plugins/types';
import { MonitorPage } from './monitor-page';

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

function isClusterStatus(value: unknown): value is ClusterStatusSnapshot {
  return typeof value === 'object' && value !== null && 'totalWorkers' in value;
}

// ────────────────────────────────────────────
// Standalone page (extension point: route)
// ────────────────────────────────────────────

function createMonitorPage(api: DashboardPluginApi) {
  return function RuntimeMonitorPage() {
    return <MonitorPage dashboard={api.dashboard} />;
  };
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
            <Badge variant="outline" className="text-xs ml-auto">
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
      title: '运行监控',
      component: MonitorPage,
    })
  );

  unregisterFns.push(
    api.registerMenuItem({
      id: 'monitor',
      label: '运行监控',
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
