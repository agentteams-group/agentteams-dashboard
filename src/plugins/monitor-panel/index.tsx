'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { OverflowText } from '@/components/dashboard/overflow-text';
import { ListPagination, useListPagination } from '@/components/dashboard/list-pagination';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';
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
    const [search, setSearch] = useState('');
    const refresh = useCallback(async () => {
      setLoading(true); setError(null);
      try {
        const [rawStatus, rawVersion, rawWorkers] = await Promise.all([api.dashboard.getClusterStatus(), api.dashboard.getVersion(), api.dashboard.listWorkers()]);
        if (isClusterStatus(rawStatus)) setStatus(rawStatus);
        setVersion((rawVersion as VersionSnapshot) ?? null);
        setWorkers(Array.isArray(rawWorkers) ? rawWorkers as WorkerRow[] : []);
        api.events.emit('monitor-panel:refreshed', { at: Date.now() });
      } catch (err) { setError(err instanceof Error ? err.message : '加载失败'); }
      finally { setLoading(false); }
    }, []);
    useEffect(() => { void refresh(); }, [refresh]);
    const filtered = workers.filter(worker => [worker.name, worker.phase].some(value => value?.toLowerCase().includes(search.toLowerCase())));
    const pagination = useListPagination(filtered, 20, search);
    const phases = workers.reduce<Record<string, number>>((counts, worker) => { const phase = worker.phase ?? 'Unknown'; counts[phase] = (counts[phase] ?? 0) + 1; return counts; }, {});
    return <div className="space-y-4">
      <SectionHeader title="运行监控" onRefresh={() => void refresh()} isRefreshing={loading}
        meta={<span className="text-sm text-muted-foreground">{status?.totalWorkers ?? '—'} 个 Agent · {status?.totalTeams ?? '—'} 个团队 · {status?.totalHumans ?? '—'} 个用户</span>} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs">
        <span className="text-muted-foreground">部署模式 <span className="ml-2 text-foreground">{status ? status.kubeMode ? 'Kubernetes' : 'Embedded' : '—'}</span></span>
        <span className="text-muted-foreground">Controller <span className="ml-2 font-mono text-foreground">{version?.controller || '—'}</span></span>
        <span className="text-muted-foreground">基础资源状态监控</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="搜索运行状态" placeholder="搜索 Agent 名称或状态…" value={search} onChange={event => setSearch(event.target.value)} className="h-9 w-full sm:max-w-sm" />
        {Object.entries(phases).map(([phase,count]) => <span key={phase} className="flex items-center gap-1.5 text-xs"><PhaseBadge kind="worker" phase={phase} /><span className="tabular-nums text-muted-foreground">{count}</span></span>)}
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">数据加载失败：{error}</p>}
      <Card className="gap-0 overflow-hidden rounded-lg py-0 shadow-none">
        {loading && !workers.length ? <div role="status" aria-label="加载中" className="space-y-3 p-4">{[0,1,2].map(item => <Skeleton key={item} className="h-10" />)}</div> : !filtered.length ? <p className="p-10 text-center text-sm text-muted-foreground">{search ? '没有匹配的 Agent' : '暂无 Worker 数据'}</p> :
          <Table className="min-w-[480px] table-fixed"><TableHeader><TableRow><TableHead>Agent</TableHead><TableHead className="w-40">运行状态</TableHead></TableRow></TableHeader><TableBody>
            {pagination.items.map(worker => <TableRow key={worker.name}><TableCell className="py-3 font-medium"><OverflowText text={worker.name} /></TableCell><TableCell><PhaseBadge kind="worker" phase={worker.phase || 'Unknown'} /></TableCell></TableRow>)}
          </TableBody></Table>}
      </Card>
      {!error && <ListPagination {...pagination} label="Agent" />}
    </div>;
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
