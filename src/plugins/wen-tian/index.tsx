'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  Check,
  CheckCircle2,
  Container,
  Copy,
  FileDown,
  FolderSearch,
  Heart,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCheck,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { apiUrl } from '@/lib/api-base';
import { pluginSectionId, type DashboardPluginApi } from '@/lib/plugins/types';
import { useMatrixStore } from '@/lib/matrix-store';
import { useAiRoutes, useModels } from '@/hooks/use-agentteams-models';
import { buildModelSelectionOptions } from '@/lib/model-catalog';
import type { WorkerResponse, TeamResponse, HumanResponse, InfrastructureInfo } from '@/lib/agentteams-api';

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

// ────────────────────────────────────────────
// SSE client
// ────────────────────────────────────────────

function collectSSE(
  url: string,
  body: unknown,
  extraHeaders?: Record<string, string>
): AsyncGenerator<{ event: string; data: unknown }, void, void> {
  return (async function* () {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
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

// ────────────────────────────────────────────
// Log collection settings (migrated from the Settings dialog)
// ────────────────────────────────────────────

const RANGE_OPTIONS = [
  { value: '10m', label: '最近 10 分钟' },
  { value: '30m', label: '最近 30 分钟' },
  { value: '1h', label: '最近 1 小时' },
  { value: '6h', label: '最近 6 小时' },
  { value: '1d', label: '最近 1 天' },
];

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return match?.[1] ?? null;
}

// ────────────────────────────────────────────
// Diagnosis model selector
// ────────────────────────────────────────────

const DEFAULT_MODEL_VALUE = '__server_default__';
const CUSTOM_MODEL_VALUE = '__custom__';

function DiagnosisModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (_value: string) => void;
  disabled?: boolean;
}) {
  const { data: providers } = useModels();
  const { data: aiRoutes } = useAiRoutes();
  const options = useMemo(
    () => buildModelSelectionOptions(aiRoutes ?? [], providers ?? []),
    [aiRoutes, providers]
  );
  const configured = options.filter((o) => o.kind === 'configured');
  const builtin = options.filter((o) => o.kind === 'builtin');
  const [customMode, setCustomMode] = useState(false);

  // Leave custom mode once the external value resolves to a selectable alias
  // (adjust state during render, per React guidance).
  if (customMode && value && options.some((o) => o.alias === value)) {
    setCustomMode(false);
  }

  const known = options.some((o) => o.alias === value);
  const customActive = customMode || (value !== '' && !known);
  const selectedOption = options.find((o) => o.alias === value);

  if (customActive) {
    return (
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <Input
            className="flex-1"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="自定义模型别名，经 AI 网关路由"
            disabled={disabled}
            aria-label="诊断模型别名"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={disabled}
            onClick={() => {
              setCustomMode(false);
              onChange('');
            }}
          >
            从列表选择
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Select
        value={value === '' ? DEFAULT_MODEL_VALUE : value}
        onValueChange={(next) => {
          if (next === CUSTOM_MODEL_VALUE) {
            setCustomMode(true);
            onChange('');
          } else if (next === DEFAULT_MODEL_VALUE) {
            onChange('');
          } else {
            onChange(next);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" aria-label="诊断模型">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[min(100vw-2rem,28rem)]">
          <SelectItem value={DEFAULT_MODEL_VALUE}>
            <span className="flex flex-col">
              <span className="font-medium">默认模型</span>
              <span className="text-xs text-muted-foreground">
                服务器配置（AGENTTEAMS_DEFAULT_MODEL），经 AI 网关调用
              </span>
            </span>
          </SelectItem>
          {configured.length > 0 && (
            <SelectGroup>
              <SelectLabel>已配置的服务商模型</SelectLabel>
              {configured.map((option) => (
                <SelectItem key={option.alias} value={option.alias}>
                  <span className="flex flex-col">
                    <span className="font-mono">{option.alias}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.binding
                        ? `${option.binding.routeName} → ${option.binding.providerName} / ${option.binding.targetModel}`
                        : ''}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {builtin.length > 0 && (
            <SelectGroup>
              <SelectLabel>内置别名（需配置路由）</SelectLabel>
              {builtin.map((option) => (
                <SelectItem key={option.alias} value={option.alias}>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono">{option.alias}</span>
                    <Badge variant="secondary" className="text-[9px]">内置</Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectSeparator />
          <SelectItem value={CUSTOM_MODEL_VALUE}>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              自定义别名…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {value === '' ? (
        <p className="text-xs text-muted-foreground">
          使用服务器端默认模型执行诊断；可在「模型管理」添加服务商模型后在此选择。
        </p>
      ) : selectedOption?.kind === 'configured' && selectedOption.binding ? (
        <p className="text-xs text-muted-foreground">
          经路由 {selectedOption.binding.routeName} 转发至{' '}
          {selectedOption.binding.providerName} / {selectedOption.binding.targetModel}
        </p>
      ) : selectedOption?.kind === 'builtin' ? (
        <p className="text-xs text-amber-600/80">
          内置模型别名，需先在「模型管理」为其配置路由映射，否则调用可能失败。
        </p>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────
// Report rendering
// ────────────────────────────────────────────

function ReportCodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border bg-muted/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted text-xs text-muted-foreground">
        <span>{language || 'code'}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-60 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
          title="复制代码"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto m-0 text-xs">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** Rich markdown renderer tuned for the AI diagnosis report. */
function DiagnosisReport({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children }) {
            return <h1 className="text-lg font-bold mt-3 mb-2 pb-1.5 border-b">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-semibold mt-4 mb-2 pb-1.5 border-b flex items-center gap-1.5">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold mt-3 mb-1.5">{children}</h3>;
          },
          p({ children }) {
            return <p className="leading-relaxed mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return <blockquote className="border-l-4 border-primary/40 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>;
          },
          hr() {
            return <hr className="my-3 border-border" />;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2 rounded-md border">
                <table className="w-full text-xs border-collapse">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-muted/60">{children}</thead>;
          },
          th({ children }) {
            return <th className="border-b px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">{children}</th>;
          },
          td({ children }) {
            return <td className="border-b border-border/60 px-2.5 py-1.5 align-top">{children}</td>;
          },
          code({ className, children, ...props }) {
            const code = String(children).replace(/\n$/, '');
            if (className?.includes('language-')) {
              return <ReportCodeBlock language={className.replace('language-', '')}>{code}</ReportCodeBlock>;
            }
            return <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono" {...props} />;
          },
          pre({ children }) {
            return <div className="my-1">{children}</div>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom rounded-sm bg-primary animate-pulse" />
      )}
    </div>
  );
}

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
    const [copied, setCopied] = useState(false);

    // ── AI 日志分析诊断（merged: symptom + collection settings + model） ──
    const [symptom, setSymptom] = useState('');
    const [range, setRange] = useState('1h');
    const [redact, setRedact] = useState(true);
    const [container, setContainer] = useState('');
    const [room, setRoom] = useState('');
    const [model, setModel] = useState('');
    const [diagRunning, setDiagRunning] = useState(false);
    const [diagProgress, setDiagProgress] = useState<{ phase: string; pct: number; message: string }>({ phase: '', pct: 0, message: '' });
    const [diagAnswer, setDiagAnswer] = useState('');
    const [diagError, setDiagError] = useState<string | null>(null);
    const [diagMeta, setDiagMeta] = useState<{ model: string; finishedAt: number } | null>(null);
    const [zipping, setZipping] = useState(false);

    const { isLoggedIn, accessToken, homeserver } = useMatrixStore();
    const matrixReady = isLoggedIn && !!accessToken && !!homeserver;

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

    // ── Rich health checks (feed the snapshot injected into the AI prompt) ──

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

    const handleDiagnose = async () => {
      if (!symptom.trim()) {
        toast.warning('请填写症状描述');
        return;
      }
      setDiagRunning(true);
      setDiagError(null);
      setDiagAnswer('');
      setDiagMeta(null);
      setDiagProgress({ phase: 'init', pct: 0, message: '准备中…' });
      try {
        const headers: Record<string, string> = {};
        if (matrixReady) headers['Authorization'] = `Bearer ${accessToken}`;
        const snapshot = buildReport({ cluster, version, workers, teams, humans, infra, checks });
        const body = {
          range,
          redact,
          container: container.trim() || undefined,
          room: room.trim() || undefined,
          homeserver: matrixReady ? homeserver : undefined,
          symptom: symptom.trim(),
          model: model.trim() || undefined,
          snapshot,
        };
        const modelLabel = model.trim() || '默认模型';
        for await (const { event, data } of collectSSE(apiUrl('/api/agentteams/wen-tian/logs'), body, headers)) {
          if (event === 'progress' && isObject(data)) {
            const d = data as Record<string, unknown>;
            setDiagProgress({
              phase: String(d['phase'] ?? ''),
              pct: typeof d['pct'] === 'number' ? (d['pct'] as number) : 0,
              message: String(d['message'] ?? ''),
            });
          } else if (event === 'chunk' && isObject(data)) {
            const d = data as Record<string, unknown>;
            if (typeof d['content'] === 'string') {
              setDiagAnswer((prev) => prev + (d['content'] as string));
            }
          } else if (event === 'result' && isObject(data)) {
            const d = data as Record<string, unknown>;
            if (typeof d['answer'] === 'string') {
              setDiagAnswer(d['answer'] as string);
              setDiagMeta({ model: modelLabel, finishedAt: Date.now() });
              toast.success('AI 日志分析诊断完成');
            }
          } else if (event === 'error' && isObject(data)) {
            const d = data as Record<string, unknown>;
            if (typeof d['error'] === 'string') {
              throw new Error(d['error'] as string);
            }
          }
        }
      } catch (err) {
        setDiagError(err instanceof Error ? err.message : 'AI 日志分析诊断失败');
        toast.error('AI 日志分析诊断失败');
      } finally {
        setDiagRunning(false);
      }
    };

    // Offline ZIP export — the log-collection capability migrated from Settings.
    const handleDownloadZip = async () => {
      setZipping(true);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (matrixReady) headers['Authorization'] = `Bearer ${accessToken}`;
        const res = await fetch(apiUrl('/api/agentteams/debug-log'), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            range,
            redact,
            container: container.trim() || undefined,
            room: room.trim() || undefined,
            homeserver: matrixReady ? homeserver : undefined,
          }),
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {
            // Non-JSON error body — keep the HTTP status message.
          }
          throw new Error(message);
        }
        const blob = await res.blob();
        const filename =
          filenameFromDisposition(res.headers.get('content-disposition')) ??
          `agentteams-debug-log-${Date.now()}.zip`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success(`日志包已下载：${filename}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '收集日志失败');
      } finally {
        setZipping(false);
      }
    };

    const handleCopyDiagAnswer = () => {
      if (!diagAnswer) return;
      navigator.clipboard.writeText(diagAnswer).then(
        () => toast.success('诊断报告已复制到剪贴板'),
        () => toast.error('复制失败，请手动复制')
      );
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

        {/* AI 日志分析诊断 — merged: symptom + log collection settings + model */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary" />
              AI 日志分析诊断
              {diagRunning && (
                <Badge variant="outline" className="text-[10px] ml-auto animate-pulse">{diagProgress.pct}%</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 1. Symptom */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                症状描述 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
                placeholder="例如：Worker 一直 Pending · 团队创建失败 · Matrix 房间没生成 · 模型调用报 429…"
                rows={3}
                disabled={diagRunning}
              />
            </div>

            {/* 2. Log collection settings (migrated from the Settings dialog) */}
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FolderSearch className="w-3.5 h-3.5" />
                日志收集配置
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">时间范围</Label>
                  <Select value={range} onValueChange={setRange} disabled={diagRunning}>
                    <SelectTrigger className="w-full" aria-label="日志时间范围">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RANGE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">容器过滤（可选）</Label>
                  <Input
                    value={container}
                    onChange={(e) => setContainer(e.target.value)}
                    placeholder="例如 agentteams-worker"
                    disabled={diagRunning}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">房间过滤（可选）</Label>
                  <Input
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="例如 Worker"
                    disabled={diagRunning}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="flex items-center gap-1.5 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    PII 脱敏
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    自动屏蔽手机号、邮箱、API Key、Token 等敏感信息（建议保持开启）
                  </p>
                </div>
                <Switch checked={redact} onCheckedChange={setRedact} disabled={diagRunning} />
              </div>
              <div className="flex items-center gap-2 text-[11px] rounded-md border bg-muted/50 px-2 py-1.5">
                <MessageSquareText className="w-3.5 h-3.5 shrink-0" />
                {matrixReady ? (
                  <span>已登录 Matrix，诊断与日志包将包含房间消息。</span>
                ) : (
                  <span className="text-muted-foreground">
                    未登录 Matrix，将跳过房间消息（仅收集容器日志与 Agent 会话）。
                  </span>
                )}
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDownloadZip()}
                  disabled={zipping || diagRunning}
                >
                  {zipping ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}
                  {zipping ? '正在收集，请稍候…' : '仅收集日志 ZIP'}
                </Button>
              </div>
            </div>

            {/* 3. Model */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">诊断模型</Label>
              <DiagnosisModelSelect value={model} onChange={setModel} disabled={diagRunning} />
            </div>

            {/* 4. Action */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button onClick={() => void handleDiagnose()} disabled={diagRunning || !symptom.trim()}>
                {diagRunning
                  ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  : <Sparkles className="w-4 h-4 mr-1" />}
                {diagRunning ? '诊断中…' : 'AI 日志分析诊断'}
              </Button>
              <span className="text-xs text-muted-foreground">
                按上方配置实时采集容器日志 / Agent 会话 / Matrix 消息，结合症状与环境快照生成结构化诊断报告
              </span>
            </div>

            {/* 5. Progress */}
            {diagRunning && (
              <div className="space-y-1.5">
                <Progress value={diagProgress.pct} />
                <p className="text-xs text-muted-foreground">{diagProgress.message || '正在收集日志并分析…'}</p>
              </div>
            )}

            {/* 6. Error */}
            {diagError && <p className="text-xs text-destructive">{diagError}</p>}

            {/* 7. Report */}
            {diagAnswer && (
              <div className="rounded-lg border overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <Heart className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-medium shrink-0">AI 诊断报告</span>
                    {diagMeta && (
                      <span className="text-muted-foreground truncate">
                        · {diagMeta.model} · {new Date(diagMeta.finishedAt).toLocaleString('zh-CN')}
                      </span>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={handleCopyDiagAnswer} disabled={!diagAnswer}>
                    <Copy className="w-3 h-3 mr-1" />
                    复制报告
                  </Button>
                </div>
                <div className="p-4 max-h-[32rem] overflow-auto bg-background">
                  <DiagnosisReport content={diagAnswer} streaming={diagRunning} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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
