'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Container,
  Copy,
  Heart,
  Loader2,
  Package,
  RefreshCw,
  Server,
  Stethoscope,
  Users,
  UserCheck,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { apiUrl } from '@/lib/api-base';
import { pluginSectionId, type DashboardPluginApi } from '@/lib/plugins/types';
import type { WorkerResponse, TeamResponse, HumanResponse, InfrastructureInfo } from '@/lib/agentteams-api';

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

type Severity = 'ok' | 'warn' | 'error';

interface CheckResult {
  id: string;
  label: string;
  severity: Severity;
  detail: string;
}

export type { CheckResult };

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

export function analyzeWorkers(workers: WorkerRow[]): { distribution: Record<string, number>; failures: string[] } {
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

export function buildChecks(args: {
  cluster: ClusterStatusSnapshot | null;
  version: VersionSnapshot | null;
  workers: WorkerResponse[];
  teams: TeamResponse[];
  humans: HumanResponse[];
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

export function buildReport(args: {
  cluster: ClusterStatusSnapshot | null;
  version: VersionSnapshot | null;
  workers: WorkerResponse[];
  teams: TeamResponse[];
  humans: HumanResponse[];
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

// AI 深度诊断 — 直接复用 wen-tian/logs SSE 端点，将症状描述注入 prompt
async function callAiDiagnose(symptom: string, report: string): Promise<string> {
  const url = apiUrl(`/api/agentteams/wen-tian/logs?range=1h&symptom=${encodeURIComponent(symptom)}`);
  let answer = '';
  for await (const { event, data } of collectSSE(url, { range: '15m', redact: false })) {
    if (event === 'chunk' && isObject(data)) {
      const d = data as Record<string, unknown>;
      if (typeof d['content'] === 'string') answer += String(d['content']);
    } else if (event === 'result' && isObject(data)) {
      const d = data as Record<string, unknown>;
      if (typeof d['answer'] === 'string') return d['answer'] as string;
    } else if (event === 'error' && isObject(data)) {
      const d = data as Record<string, unknown>;
      if (typeof d['error'] === 'string') throw new Error(d['error'] as string);
    }
  }
  return answer;
}

interface LogAnalysisState {
  running: boolean;
  progress: { phase: string; pct: number; message: string };
  summary: Record<string, unknown> | null;
  error: string | null;
  answer: string;
}

function collectSSE(url: string, body: unknown): AsyncGenerator<{ event: string; data: unknown }, void, void> {
  return (async function* () {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'data';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const obj = JSON.parse(raw);
              yield { event: currentEvent, data: obj };
            } catch { /* ignore */ }
          } else if (line === '') {
            // empty line = end of SSE event, reset currentEvent
            currentEvent = 'data';
          }
        }
      }
    } finally { reader.releaseLock(); }
  })();
}

async function collectAndAnalyzeLogs(opts: { range: string; redact: boolean }): Promise<string> {
  const params = new URLSearchParams({ range: opts.range });
  const url = apiUrl(`/api/agentteams/wen-tian/logs?${params}`);
  let answer = '';
  for await (const { event, data } of collectSSE(url, { range: opts.range, redact: opts.redact })) {
    if (event === 'chunk' && typeof (data as Record<string, unknown>)['content'] === 'string') {
      answer += String((data as Record<string, unknown>)['content']);
    } else if (event === 'result') {
      const d = data as Record<string, unknown>;
      if (typeof d['answer'] === 'string') return d['answer'] as string;
    } else if (event === 'error') {
      const d = data as Record<string, unknown>;
      if (typeof d['error'] === 'string') throw new Error(d['error'] as string);
    }
  }
  return answer;
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
    const [workers, setWorkers] = useState<WorkerResponse[]>([]);
    const [teams, setTeams] = useState<TeamResponse[]>([]);
    const [humans, setHumans] = useState<HumanResponse[]>([]);
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
        setWorkers(Array.isArray(rawWorkers) ? (rawWorkers as WorkerResponse[]) : []);
        setTeams(Array.isArray(rawTeams) ? (rawTeams as TeamResponse[]) : []);
        setHumans(Array.isArray(rawHumans) ? (rawHumans as HumanResponse[]) : []);
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

    // ── Rich health checks ──────────────────────────────────────────────

    const checks = useMemo(() => {
      const result: CheckResult[] = [];

      // 1. Deployment mode
      result.push({
        id: 'deployment-mode',
        label: '部署模式',
        severity: cluster ? 'ok' : 'warn',
        detail: cluster
          ? `${cluster.kubeMode ? 'Kubernetes (incluster)' : 'Embedded (standalone)'}`
          : '尚未获取到集群状态',
      });

      // 2. Controller / Dashboard version
      const ctrlVer = version?.controller ?? '未知';
      const dashVer = version?.dashboard ?? '未知';
      const verOk = version?.controller && version?.dashboard;
      result.push({
        id: 'version-consistency',
        label: '版本信息',
        severity: verOk ? 'ok' : 'warn',
        detail: verOk
          ? `Controller ${ctrlVer} · Dashboard ${dashVer}`
          : `Controller ${ctrlVer} · Dashboard ${dashVer}（无法读取完整版本）`,
      });

      // 3. Workers — rich analysis
      const totalW = workers.length;
      const runningW = workers.filter((w) => w.phase === 'Running' || w.phase === 'Ready').length;
      const failedW = workers.filter((w) => w.phase === 'Failed').length;
      const pendingW = workers.filter((w) => w.phase === 'Pending').length;
      const updatingW = workers.filter((w) => w.phase === 'Updating').length;
      const sleepingW = workers.filter((w) => w.phase === 'Sleeping').length;
      const workerMsgs = workers.filter((w) => w.message).slice(0, 3).map((w) => `${w.name}: ${w.message}`).join('；');
      result.push({
        id: 'workers',
        label: 'Workers',
        severity: failedW > 0 ? 'error' : pendingW > 0 && totalW > 0 ? 'warn' : 'ok',
        detail: `${runningW}/${totalW} 运行中${failedW > 0 ? ` · ${failedW} Failed` : ''}${pendingW > 0 ? ` · ${pendingW} Pending` : ''}${updatingW > 0 ? ` · ${updatingW} Updating` : ''}${sleepingW > 0 ? ` · ${sleepingW} Sleeping` : ''}${workerMsgs ? ' · ' + workerMsgs : ''}`,
      });

      // 4. Teams — rich analysis
      const totalT = teams.length;
      const activeT = teams.filter((t) => t.phase === 'Active').length;
      const degradedT = teams.filter((t) => t.phase === 'Degraded').length;
      const failedT = teams.filter((t) => t.phase === 'Failed').length;
      const workerMismatch = teams.filter((t) => t.totalWorkers > 0 && t.readyWorkers < t.totalWorkers).length;
      result.push({
        id: 'teams',
        label: '团队',
        severity: failedT > 0 ? 'error' : degradedT > 0 || workerMismatch > 0 ? 'warn' : 'ok',
        detail: `${activeT}/${totalT} 活跃${degradedT > 0 ? ` · ${degradedT} Degraded` : ''}${failedT > 0 ? ` · ${failedT} Failed` : ''}${workerMismatch > 0 ? ` · ${workerMismatch}  Workers不足` : ''}`,
      });

      // 5. Humans
      const totalH = humans.length;
      const activeH = humans.filter((h) => h.phase === 'Active').length;
      const failedH = humans.filter((h) => h.phase === 'Failed').length;
      result.push({
        id: 'humans',
        label: 'Humans',
        severity: failedH > 0 ? 'error' : totalH > 0 && activeH === 0 ? 'warn' : 'ok',
        detail: `${activeH}/${totalH} 活跃${failedH > 0 ? ` · ${failedH} Failed` : ''}`,
      });

      // 6. Infrastructure — richer
      const minioOk = !!infra?.minio?.healthy;
      const matrixOk = !!infra?.matrix?.healthy;
      const higressOk = !!infra?.higress?.healthy;
      const k8sOk = !!infra?.kubernetes?.healthy;
      const ctrlOk = !!infra?.controller?.healthy;
      const infraSev: Severity = !infra
        ? 'warn'
        : minioOk && matrixOk && higressOk && k8sOk && ctrlOk
          ? 'ok'
          : minioOk || matrixOk || higressOk
            ? 'warn'
            : 'error';
      result.push({
        id: 'infra',
        label: '基础设施',
        severity: infraSev,
        detail: [
          `MinIO ${minioOk ? '✓' : '✗'}`,
          `Matrix ${matrixOk ? '✓' : '✗'}`,
          `Higress ${higressOk ? '✓' : '✗'}`,
          k8sOk ? `K8s ✓` : null,
          ctrlOk ? `Controller ✓` : null,
        ].filter(Boolean).join(' · '),
      });

      // 7. Aggregate severity
      const errorCount = result.filter((c) => c.severity === 'error').length;
      const warnCount = result.filter((c) => c.severity === 'warn').length;
      result.push({
        id: 'severity-rollup',
        label: '健康汇总',
        severity: errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
        detail:
          errorCount > 0
            ? `${errorCount} 项异常、${warnCount} 项警告，建议立即处理`
            : warnCount > 0
              ? `${warnCount} 项警告，建议排查`
              : '全部正常，系统健康',
      });

      return result;
    }, [cluster, version, workers, teams, humans, infra]);

    const handleCopyReport = () => {
      navigator.clipboard.writeText(
        [
          '# 问天诊断报告',
          `生成时间：${new Date().toISOString()}`,
          '',
          `Workers: ${workers.length} (运行中 ${workers.filter((w) => w.phase === 'Running' || w.phase === 'Ready').length})`,
          `团队: ${teams.length} (活跃 ${teams.filter((t) => t.phase === 'Active').length})`,
          `Humans: ${humans.length} (活跃 ${humans.filter((h) => h.phase === 'Active').length})`,
          `部署模式: ${cluster?.kubeMode ? 'K8s' : 'Embedded'}`,
          `Controller: ${version?.controller ?? '未知'}`,
          `Dashboard: ${version?.dashboard ?? '未知'}`,
        ].join('\n')
      ).then(
        () => {
          setCopied(true);
          toast.success('诊断报告已复制到剪贴板');
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
        const answer = await callAiDiagnose(symptom.trim(), report);
        setAiAnswer(answer);
        api.events.emit('wen-tian:diagnosed', {
          at: Date.now(),
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
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button size="sm" onClick={handleCopyReport} disabled={loading}>
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

        {/* Cluster overview stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryStat icon={<Bot className="w-4 h-4" />} label="Workers" value={workers.length} sub={`${workers.filter((w) => w.phase === 'Running' || w.phase === 'Ready').length} 运行中`} />
          <SummaryStat icon={<Users className="w-4 h-4" />} label="团队" value={teams.length} sub={`${teams.filter((t) => t.phase === 'Active').length} 活跃`} />
          <SummaryStat icon={<UserCheck className="w-4 h-4" />} label="Humans" value={humans.length} sub={`${humans.filter((h) => h.phase === 'Active').length} 活跃`} />
          <SummaryStat
            icon={<Container className="w-4 h-4" />}
            label="部署模式"
            value={cluster ? (cluster.kubeMode ? 'K8s' : 'Embedded') : '--'}
            textMode
          />
        </div>

        {/* AI diagnose */}
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
              <div className="rounded-md border bg-muted/40 p-3 max-h-96 overflow-auto text-xs prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiAnswer}</ReactMarkdown>
              </div>
            )}
          </CardContent>
        </Card>

        <LogAnalysisSection />

      </div>
    );
  };
}

function SummaryStat({
  icon,
  label,
  value,
  sub,
  textMode,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  textMode?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
        <div>
          <div className={`${textMode ? 'text-base' : 'text-2xl'} font-bold leading-tight`}>{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
          {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
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
// Log Analysis Section
// ────────────────────────────────────────────

function LogAnalysisSection() {
  const [state, setState] = useState<LogAnalysisState>({ running: false, progress: { phase: '', pct: 0, message: '' }, summary: null, error: null, answer: '' });

  const handleAnalyze = useCallback(async () => {
    setState({ running: true, progress: { phase: 'init', pct: 0, message: '准备中…' }, summary: null, error: null, answer: '' });
    try {
      for await (const { event, data } of collectSSE(apiUrl('/api/agentteams/wen-tian/logs?range=1h'), { range: '1h', redact: true })) {
        if (event === 'progress' && isObject(data)) {
          const d = data as Record<string, unknown>;
          setState((s) => ({
            ...s,
            progress: {
              phase: String(d['phase'] ?? ''),
              pct: typeof d['pct'] === 'number' ? d['pct'] : s.progress.pct,
              message: String(d['message'] ?? ''),
            },
          }));
        } else if (event === 'summary' && isObject(data)) {
          const d = data as Record<string, unknown>;
          setState((s) => ({ ...s, summary: d as Record<string, unknown> }));
        } else if (event === 'chunk' && isObject(data)) {
          const d = data as Record<string, unknown>;
          if (typeof d['content'] === 'string') {
            setState((s) => ({ ...s, answer: s.answer + String(d['content']) }));
          }
        } else if (event === 'result' && isObject(data)) {
          const d = data as Record<string, unknown>;
          if (typeof d['answer'] === 'string') {
            setState((s) => ({ ...s, running: false, answer: d['answer'] as string }));
            toast.success('日志分析完成');
          }
        } else if (event === 'error' && isObject(data)) {
          const d = data as Record<string, unknown>;
          if (typeof d['error'] === 'string') {
            setState((s) => ({ ...s, running: false, error: d['error'] as string }));
            toast.error('日志分析失败');
          }
        }
      }
    } catch (err) {
      setState((s) => ({ ...s, running: false, error: err instanceof Error ? err.message : '未知错误' }));
      toast.error('日志分析失败');
    }
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Clock className={`w-4 h-4 text-primary ${state.running ? 'animate-spin' : ''}`} />
          日志分析
          {state.running && <Badge variant="outline" className="text-[10px] ml-auto animate-pulse">{state.progress.pct}%</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.running && (
          <>
            <Progress value={state.progress.pct} />
            <p className="text-xs text-muted-foreground">{state.progress.message || '正在收集日志并分析…'}</p>
          </>
        )}
        {!state.running && (
          <>
            <p className="text-xs text-muted-foreground">分析过去 1 小时内的容器日志、Agent 会话和 Matrix 消息，由 AI 给出诊断结论与修复建议。</p>
            <Button onClick={() => void handleAnalyze()} variant="outline" size="sm">
              <Zap className="w-4 h-4 mr-1" />
              开始日志分析
            </Button>
          </>
        )}
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        {state.answer && (
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium">AI 诊断结果</span>
            </div>
            <div className="rounded-md border bg-muted/40 p-3 max-h-96 overflow-auto text-xs prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.answer}</ReactMarkdown>
              </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
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