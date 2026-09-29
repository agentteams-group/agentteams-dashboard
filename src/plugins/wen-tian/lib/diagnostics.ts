import type { WorkerResponse, TeamResponse, HumanResponse, InfrastructureInfo } from '@/lib/agentteams-api';

export interface ClusterStatusSnapshot {
  totalWorkers: number;
  totalTeams: number;
  totalHumans: number;
  kubeMode: boolean;
}

export interface VersionSnapshot {
  controller?: string;
  dashboard?: string;
}

export interface WorkerRow {
  name: string;
  phase?: string;
}

export type Severity = 'ok' | 'warn' | 'error';

export interface CheckResult {
  id: string;
  label: string;
  severity: Severity;
  detail: string;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
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

export function collectSSE(
  url: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
  signal?: AbortSignal
): AsyncGenerator<{ event: string; data: unknown }, void, void> {
  return (async function* () {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
      signal,
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

export const RANGE_OPTIONS = [
  { value: '10m', label: '最近 10 分钟' },
  { value: '30m', label: '最近 30 分钟' },
  { value: '1h', label: '最近 1 小时' },
  { value: '6h', label: '最近 6 小时' },
  { value: '1d', label: '最近 1 天' },
];

export function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return match?.[1] ?? null;
}
