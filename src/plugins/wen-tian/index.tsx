'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Container,
  Copy,
  Loader2,
  Package,
  RefreshCw,
  Server,
  Stethoscope,
  Users,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { apiUrl } from '@/lib/api-base';
import { pluginSectionId, type DashboardPluginApi } from '@/lib/plugins/types';

/**
 * 问天 (WenTian) — bundled plugin: runtime diagnostic assistant.
 *
 * Three extension points:
 *   - sidebar-menu : "问天诊断" entry (Stethoscope icon)
 *   - route        : standalone diagnostic page (7 health checks, AI deep-dive)
 *   - dashboard-widget : compact health-overview card on the overview page
 *
 * The AI-powered "deep diagnosis" piggybacks on the existing Controller
 * troubleshoot endpoint so the request flows through the default AI Gateway
 * model — plugins do not (and should not) hold their own LLM credentials.
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

interface TeamRow {
  name: string;
  phase?: string;
}

interface HumanRow {
  name: string;
  phase?: string;
}

interface InfrastructureInfo {
  minio?: { healthy: boolean; endpoint: string; buckets: string[] };
  higress?: { healthy: boolean; gateway: { healthy: boolean }; console: { healthy: boolean } };
  matrix?: { healthy: boolean; homeserver: string };
}

type Severity = 'ok' | 'warn' | 'error';

interface CheckResult {
  id: string;
  label: string;
  severity: Severity;
  detail: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// ────────────────────────────────────────────
// Diagnostic helpers
// ────────────────────────────────────────────

function analyzeWorkers(workers: WorkerRow[]): { distribution: Record<string, number>; failures: string[] } {
  const distribution: Record<string, number> = {};
  const failures: string[] = [];
  for (const w of workers) {
    const phase = w.phase ?? 'Unknown';
    distribution[phase] = (distribution[phase] ?? 0) + 1;
    if (phase === 'Failed' || phase === 'Updating') failures.push(`${w.name} (${phase})`);
  }
  return { distribution, failures };
}

function analyzeVersion(
  version: VersionSnapshot | null,
  cluster: ClusterStatusSnapshot | null
): string {
  if (!version) return '无法获取版本信息';
  const parts: string[] = [];
  if (version.controller) parts.push(`Controller ${version.controller}`);
  if (version.dashboard) parts.push(`Dashboard ${version.dashboard}`);
  if (cluster) parts.push(cluster.kubeMode ? 'K8s 模式' : '嵌入式模式');
  return parts.join(' · ');
}

function buildChecks(args: {
  cluster: ClusterStatusSnapshot | null;
  version: VersionSnapshot | null;
  workers: WorkerRow[];
  teams: TeamRow[];
  humans: HumanRow[];
  infra: InfrastructureInfo | null;
}): CheckResult[] {
  const { cluster, version, workers, teams, humans, infra } = args;
  const checks: CheckResult[] = [];

  // 1. 部署模式识别
  checks.push({
    id: 'deployment-mode',
    label: '部署模式识别',
    severity: cluster ? 'ok' : 'warn',
    detail: cluster
      ? cluster.kubeMode
        ? 'Kubernetes 集群模式'
        : '嵌入式 (embedded) 模式'
      : '尚未获取到集群状态',
  });

  // 2. 组件健康 (Worker / 团队 / Human)
  const componentTotals = [
    { name: 'Workers', count: cluster?.totalWorkers ?? 0 },
    { name: '团队', count: cluster?.totalTeams ?? 0 },
    { name: 'Humans', count: cluster?.totalHumans ?? 0 },
  ];
  const zeroComponents = componentTotals.filter((c) => c.count === 0);
  checks.push({
    id: 'component-health',
    label: '组件健康',
    severity: zeroComponents.length === componentTotals.length ? 'error' : zeroComponents.length > 0 ? 'warn' : 'ok',
    detail:
      zeroComponents.length === 0
        ? `Workers ${componentTotals[0].count} · 团队 ${componentTotals[1].count} · Humans ${componentTotals[2].count}`
        : `未配置组件：${zeroComponents.map((c) => c.name).join('、')}`,
  });

  // 3. 版本一致性 (Controller / Dashboard)
  checks.push({
    id: 'version-consistency',
    label: '版本一致性',
    severity: !version ? 'warn' : version.controller && version.dashboard ? 'ok' : 'warn',
    detail: analyzeVersion(version, cluster),
  });

  // 4. Worker Phase 分布
  const { distribution, failures } = analyzeWorkers(workers);
  const failedCount = distribution.Failed ?? 0;
  const pendingCount = distribution.Pending ?? 0;
  let workerSeverity: Severity = 'ok';
  let workerDetail = `共 ${workers.length} 个 Worker`;
  if (failedCount > 0) {
    workerSeverity = 'error';
    workerDetail = `${failedCount} 个 Failed: ${failures.slice(0, 3).join(', ')}`;
  } else if (pendingCount > 0 && workers.length > 0) {
    workerSeverity = 'warn';
    workerDetail = `${pendingCount} 个 Pending`;
  }
  if (workers.length > 0) {
    workerDetail += ` · 分布: ${Object.entries(distribution)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`;
  }
  checks.push({
    id: 'worker-phase',
    label: 'Worker Phase 分布',
    severity: workerSeverity,
    detail: workerDetail,
  });

  // 5. 团队 / Human phase 兜底
  const degradedTeams = teams.filter((t) => t.phase === 'Degraded' || t.phase === 'Failed').length;
  const failedHumans = humans.filter((h) => h.phase === 'Failed').length;
  checks.push({
    id: 'team-human',
    label: '团队 / Human 状态',
    severity: degradedTeams + failedHumans === 0 ? 'ok' : degradedTeams + failedHumans > 0 ? 'warn' : 'ok',
    detail:
      degradedTeams + failedHumans === 0
        ? `团队 ${teams.length} · Human ${humans.length} 全部正常`
        : `Degraded/Failed 团队 ${degradedTeams} · Failed Human ${failedHumans}`,
  });

  // 6. 基础设施连通性
  const minioOk = !!infra?.minio?.healthy;
  const matrixOk = !!infra?.matrix?.healthy;
  const higressOk = !!infra?.higress?.healthy;
  const infraSev: Severity = !infra ? 'warn' : minioOk && matrixOk && higressOk ? 'ok' : minioOk || matrixOk ? 'warn' : 'error';
  checks.push({
    id: 'infra',
    label: '基础设施连通性',
    severity: infraSev,
    detail: !infra
      ? '无法获取基础设施信息'
      : `MinIO ${minioOk ? '✓' : '✗'} · Matrix ${matrixOk ? '✓' : '✗'} · Higress ${higressOk ? '✓' : '✗'}`,
  });

  // 7. 严重等级汇总
  const errorCount = checks.filter((c) => c.severity === 'error').length;
  const warnCount = checks.filter((c) => c.severity === 'warn').length;
  checks.push({
    id: 'severity-rollup',
    label: '严重等级汇总',
    severity: errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
    detail:
      errorCount > 0
        ? `${errorCount} 项 error${warnCount > 0 ? `、${warnCount} 项 warn` : ''}，建议立即处理`
        : warnCount > 0
          ? `${warnCount} 项 warn，建议排查`
          : '所有检查通过',
  });

  return checks;
}

function buildReport(args: {
  cluster: ClusterStatusSnapshot | null;
  version: VersionSnapshot | null;
  workers: WorkerRow[];
  teams: TeamRow[];
  humans: HumanRow[];
  infra: InfrastructureInfo | null;
  checks: CheckResult[];
}): string {
  const { cluster, version, workers, teams, humans, infra, checks } = args;
  const { distribution } = analyzeWorkers(workers);
  const lines: string[] = [];
  lines.push('# 问天诊断报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 环境');
  lines.push(`- 部署模式：${cluster ? (cluster.kubeMode ? 'Kubernetes' : 'Embedded') : '未知'}`);
  lines.push(`- Controller 版本：${version?.controller ?? '未知'}`);
  lines.push(`- Dashboard 版本：${version?.dashboard ?? '未知'}`);
  lines.push(`- Workers：${cluster?.totalWorkers ?? workers.length}`);
  lines.push(`- 团队：${cluster?.totalTeams ?? teams.length}`);
  lines.push(`- Humans：${cluster?.totalHumans ?? humans.length}`);
  lines.push('');
  lines.push('## Worker Phase 分布');
  if (Object.keys(distribution).length === 0) {
    lines.push('- 无数据');
  } else {
    for (const [phase, count] of Object.entries(distribution)) {
      lines.push(`- ${phase}: ${count}`);
    }
  }
  lines.push('');
  lines.push('## 基础设施');
  lines.push(`- MinIO：${infra?.minio?.healthy ? '健康' : '异常'} (${infra?.minio?.endpoint ?? 'n/a'})`);
  lines.push(`- Matrix：${infra?.matrix?.healthy ? '健康' : '异常'} (${infra?.matrix?.homeserver ?? 'n/a'})`);
  lines.push(`- Higress：${infra?.higress?.healthy ? '健康' : '异常'}`);
  lines.push('');
  lines.push('## 检查项');
  for (const check of checks) {
    const marker = check.severity === 'error' ? '✗' : check.severity === 'warn' ? '!' : '✓';
    lines.push(`- [${marker}] ${check.label}: ${check.detail}`);
  }
  return lines.join('\n');
}

async function callTroubleshoot(body: {
  component: string;
  symptom: string;
  logs?: string;
  infraSnapshot?: InfrastructureInfo;
}): Promise<string> {
  const res = await fetch(apiUrl('/api/agentteams/troubleshoot'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`诊断请求失败: HTTP ${res.status}${text ? ` · ${text}` : ''}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();
  return buffer;
}

const SEVERITY_LABELS: Record<Severity, { label: string; icon: React.ReactNode; badgeClass: string }> = {
  ok: {
    label: '通过',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  },
  warn: {
    label: '警告',
    icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  error: {
    label: '异常',
    icon: <XCircle className="w-4 h-4 text-red-500" />,
    badgeClass: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
  },
};

// ────────────────────────────────────────────
// Standalone page (extension point: route)
// ────────────────────────────────────────────

function createDiagnosticsPage(api: DashboardPluginApi) {
  return function DiagnosticsPage() {
    const [cluster, setCluster] = useState<ClusterStatusSnapshot | null>(null);
    const [version, setVersion] = useState<VersionSnapshot | null>(null);
    const [workers, setWorkers] = useState<WorkerRow[]>([]);
    const [teams, setTeams] = useState<TeamRow[]>([]);
    const [humans, setHumans] = useState<HumanRow[]>([]);
    const [infra, setInfra] = useState<InfrastructureInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [symptom, setSymptom] = useState('');
    const [aiRunning, setAiRunning] = useState(false);
    const [aiAnswer, setAiAnswer] = useState<string | null>(null);
    const [aiError, setAiError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const refresh = useCallback(async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const [rawStatus, rawVersion, rawWorkers, rawTeams, rawHumans, rawInfra] = await Promise.all([
          api.dashboard.getClusterStatus(),
          api.dashboard.getVersion(),
          api.dashboard.listWorkers(),
          api.dashboard.listTeams(),
          api.dashboard.listHumans(),
          api.http.get<unknown>('/api/agentteams/infrastructure/'),
        ]);
        if (isObject(rawStatus)) {
          setCluster({
            totalWorkers: asNumber(rawStatus.totalWorkers) ?? 0,
            totalTeams: asNumber(rawStatus.totalTeams) ?? 0,
            totalHumans: asNumber(rawStatus.totalHumans) ?? 0,
            kubeMode: !!rawStatus.kubeMode,
          });
        }
        if (isObject(rawVersion)) {
          setVersion({
            controller: asString(rawVersion.controller),
            dashboard: asString(rawVersion.dashboard),
          });
        }
        setWorkers(Array.isArray(rawWorkers) ? (rawWorkers as WorkerRow[]) : []);
        setTeams(Array.isArray(rawTeams) ? (rawTeams as TeamRow[]) : []);
        setHumans(Array.isArray(rawHumans) ? (rawHumans as HumanRow[]) : []);
        setInfra(isObject(rawInfra) ? (rawInfra as InfrastructureInfo) : null);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    }, [api]);

    useEffect(() => {
      void refresh();
    }, [refresh]);

    const checks = useMemo(
      () => buildChecks({ cluster, version, workers, teams, humans, infra }),
      [cluster, version, workers, teams, humans, infra]
    );

    const rollup = useMemo(() => {
      const errorCount = checks.filter((c) => c.severity === 'error').length;
      const warnCount = checks.filter((c) => c.severity === 'warn').length;
      if (errorCount > 0) return { severity: 'error' as Severity, label: `严重 (${errorCount})` };
      if (warnCount > 0) return { severity: 'warn' as Severity, label: `需关注 (${warnCount})` };
      return { severity: 'ok' as Severity, label: '全部正常' };
    }, [checks]);

    const handleCopyReport = () => {
      const report = buildReport({ cluster, version, workers, teams, humans, infra, checks });
      navigator.clipboard.writeText(report).then(
        () => {
          setCopied(true);
          toast.success('诊断报告已复制到剪贴板');
          api.events.emit('wen-tian:diagnosed', {
            at: Date.now(),
            severity: rollup.severity,
            checks: checks.length,
            errorCount: checks.filter((c) => c.severity === 'error').length,
            warnCount: checks.filter((c) => c.severity === 'warn').length,
          });
          setTimeout(() => setCopied(false), 2000);
        },
        () => toast.error('复制失败，请手动复制')
      );
    };

    const handleAiDiagnose = async () => {
      if (!symptom.trim()) {
        toast.warning('请填写症状描述');
        return;
      }
      setAiRunning(true);
      setAiError(null);
      setAiAnswer('');
      try {
        const report = buildReport({ cluster, version, workers, teams, humans, infra, checks });
        const augmented = [
          symptom.trim(),
          '',
          '—— 当前问天诊断快照 ——',
          report,
        ].join('\n');
        const answer = await callTroubleshoot({
          component: 'dashboard',
          symptom: augmented,
          infraSnapshot: infra ?? undefined,
        });
        setAiAnswer(answer);
        api.events.emit('wen-tian:diagnosed', {
          at: Date.now(),
          severity: rollup.severity,
          aiPowered: true,
        });
      } catch (err) {
        setAiError(err instanceof Error ? err.message : 'AI 诊断失败');
      } finally {
        setAiRunning(false);
      }
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">问天诊断</h2>
            <Badge variant="outline" className="text-xs">内置插件</Badge>
            <Badge variant="secondary" className={SEVERITY_LABELS[rollup.severity].badgeClass}>
              {SEVERITY_LABELS[rollup.severity].icon}
              <span className="ml-1">{rollup.label}</span>
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button size="sm" onClick={handleCopyReport} disabled={loading || checks.length === 0}>
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              复制报告
            </Button>
          </div>
        </div>

        {fetchError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            数据加载失败：{fetchError}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryStat icon={<Bot className="w-4 h-4" />} label="Workers" value={cluster?.totalWorkers ?? workers.length} />
          <SummaryStat icon={<Users className="w-4 h-4" />} label="团队" value={cluster?.totalTeams ?? teams.length} />
          <SummaryStat icon={<UserCheck className="w-4 h-4" />} label="Humans" value={cluster?.totalHumans ?? humans.length} />
          <SummaryStat
            icon={<Container className="w-4 h-4" />}
            label="部署模式"
            value={cluster ? (cluster.kubeMode ? 'K8s' : 'Embedded') : '--'}
            textMode
          />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-primary" />
              7 项健康检查
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {checks.map((check) => {
              const meta = SEVERITY_LABELS[check.severity];
              return (
                <div
                  key={check.id}
                  className="flex items-start gap-3 rounded-md border border-border/60 px-3 py-2"
                  data-severity={check.severity}
                >
                  <div className="mt-0.5">{meta.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{check.label}</span>
                      <Badge variant="outline" className={`text-[10px] h-4 px-1 ${meta.badgeClass}`}>
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground break-words mt-0.5">{check.detail}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Stethoscope className="w-4 h-4 text-primary" />
              AI 深度诊断（走默认模型）
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">症状描述</Label>
              <Textarea
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
                placeholder="例如：Worker 一直 Pending · 团队创建失败 · Matrix 房间没生成..."
                rows={3}
              />
            </div>
            <Button onClick={() => void handleAiDiagnose()} disabled={aiRunning || !symptom.trim()}>
              {aiRunning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Stethoscope className="w-4 h-4 mr-1" />}
              {aiRunning ? '诊断中...' : 'AI 诊断'}
            </Button>
            {aiError && <p className="text-xs text-destructive">{aiError}</p>}
            {aiAnswer && (
              <pre className="text-xs whitespace-pre-wrap rounded-md border bg-muted/40 p-3 max-h-80 overflow-auto">
                {aiAnswer}
              </pre>
            )}
          </CardContent>
        </Card>

        {infra && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Server className="w-4 h-4 text-primary" />
                基础设施连通性
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <InfraLine label="MinIO" ok={!!infra.minio?.healthy} detail={infra.minio?.endpoint} />
              <InfraLine label="Matrix" ok={!!infra.matrix?.healthy} detail={infra.matrix?.homeserver} />
              <InfraLine label="Higress" ok={!!infra.higress?.healthy} detail="AI Gateway" />
            </CardContent>
          </Card>
        )}
      </div>
    );
  };
}

function SummaryStat({
  icon,
  label,
  value,
  textMode,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  textMode?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
        <div>
          <div className={`${textMode ? 'text-base' : 'text-2xl'} font-bold leading-tight`}>{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfraLine({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
      <span className="font-medium">{label}</span>
      {detail && <span className="text-muted-foreground truncate">{detail}</span>}
    </div>
  );
}

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
    }, [api]);

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