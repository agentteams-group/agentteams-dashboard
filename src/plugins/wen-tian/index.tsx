'use client';

import { useEffect, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pluginSectionId, type DashboardPluginApi } from '@/lib/plugins/types';
import { asNumber, isObject, type ClusterStatusSnapshot } from './lib/diagnostics';
import { createDiagnosticsPage } from './diagnostics-page';

export { analyzeWorkers, buildChecks, buildReport } from './lib/diagnostics';
export type { CheckResult } from './lib/diagnostics';
export { DiagnosisReport } from './diagnosis-report';

/**
 * 问天 (WenTian) — bundled plugin: runtime diagnostic assistant.
 *
 * Three extension points:
 *   - sidebar-menu : "问天诊断" entry (Stethoscope icon)
 *   - route        : standalone diagnostic page (health snapshot + merged AI
 *                    log-analysis diagnosis)
 *   - dashboard-widget : compact health-overview card on the overview page
 *
 * The merged "AI 日志分析诊断" flow POSTs to the wen-tian/logs SSE endpoint:
 * the server collects container logs / agent sessions / matrix messages using
 * the on-card collection settings, combines them with the user's symptom
 * description and a dashboard snapshot, and streams a structured markdown
 * report back. The LLM call runs server-side through the AI gateway so
 * plugins never hold credentials; the model alias is selectable (default =
 * server-side AGENTTEAMS_DEFAULT_MODEL, or any configured provider model).
 */

// ────────────────────────────────────────────
// Overview widget (extension point: dashboard-widget)
// ────────────────────────────────────────────

function createHealthWidget(api: DashboardPluginApi) {
  return function WenTianHealthWidget() {
    const [cluster, setCluster] = useState<ClusterStatusSnapshot | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        try {
          const raw = await api.dashboard.getClusterStatus();
          if (cancelled) return;
          if (isObject(raw)) {
            setCluster({
              totalWorkers: asNumber(raw.totalWorkers) ?? 0,
              totalTeams: asNumber(raw.totalTeams) ?? 0,
              totalHumans: asNumber(raw.totalHumans) ?? 0,
              kubeMode: !!raw.kubeMode,
            });
          }
        } catch {
          /* widget must never crash the overview page */
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      setLoading(true);
      void load();
      return () => {
        cancelled = true;
      };
    }, []);

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Stethoscope className="w-4 h-4 text-primary" />
            环境健康概览
            <Badge variant="outline" className="text-[10px] ml-auto">问天</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {loading && !cluster ? (
            <p className="text-muted-foreground text-xs">加载中…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xl font-bold">{cluster?.totalWorkers ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Workers</div>
                </div>
                <div>
                  <div className="text-xl font-bold">{cluster?.totalTeams ?? 0}</div>
                  <div className="text-xs text-muted-foreground">团队</div>
                </div>
                <div>
                  <div className="text-xl font-bold">{cluster?.totalHumans ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Humans</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => api.dashboard.navigate(pluginSectionId('wen-tian', 'diagnose'))}
              >
                <Stethoscope className="w-3.5 h-3.5 mr-1" />
                打开问天诊断
              </Button>
            </>
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
  const DiagnosticsPage = createDiagnosticsPage(api);
  const HealthWidget = createHealthWidget(api);

  unregisterFns.push(
    api.registerRoute({
      id: 'diagnose',
      title: '问天诊断',
      component: DiagnosticsPage,
    })
  );

  unregisterFns.push(
    api.registerMenuItem({
      id: 'wen-tian-diagnose',
      label: '问天诊断',
      icon: 'stethoscope',
      target: { type: 'plugin-route', routeId: 'diagnose' },
    })
  );

  unregisterFns.push(
    api.registerWidget({
      id: 'wen-tian-health',
      title: '环境健康概览',
      component: HealthWidget,
      size: 'md',
    })
  );

  api.log.info('问天诊断插件已激活');
}

export function deactivate(): void {
  while (unregisterFns.length > 0) {
    const fn = unregisterFns.pop();
    fn?.();
  }
}

const wenTianPlugin = { activate, deactivate };

export default wenTianPlugin;
