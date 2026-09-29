'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { apiUrl } from '@/lib/api-base';
import type { DashboardPluginApi } from '@/lib/plugins/types';
import { useMatrixStore } from '@/lib/matrix-store';
import type { WorkerResponse, TeamResponse, HumanResponse, InfrastructureInfo } from '@/lib/agentteams-api';
import {
  asNumber,
  asString,
  buildReport,
  collectSSE,
  filenameFromDisposition,
  isObject,
  RANGE_OPTIONS,
  type CheckResult,
  type ClusterStatusSnapshot,
  type Severity,
  type VersionSnapshot,
} from './lib/diagnostics';
import { DiagnosisModelSelect } from './diagnosis-model-select';
import { DiagnosisReport } from './diagnosis-report';

// ────────────────────────────────────────────
// Standalone page (extension point: route)
// ────────────────────────────────────────────

export function createDiagnosticsPage(api: DashboardPluginApi) {
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
    // FUNC-05: abort channel for the SSE diagnosis stream — the old request
    // must stop when the user re-runs the diagnosis or leaves the page.
    const diagAbortRef = useRef<AbortController | null>(null);

    useEffect(() => () => diagAbortRef.current?.abort(), []);

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
    }, []);

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
      // FUNC-05: abort any in-flight stream before starting a new one.
      diagAbortRef.current?.abort();
      const controller = new AbortController();
      diagAbortRef.current = controller;
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
        for await (const { event, data } of collectSSE(apiUrl('/api/agentteams/wen-tian/logs'), body, headers, controller.signal)) {
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
        // FUNC-05: an abort is an intentional stop (unmount / re-run), not a
        // diagnostic failure — leave the partial answer in place quietly.
        if (controller.signal.aborted) return;
        setDiagError(err instanceof Error ? err.message : 'AI 日志分析诊断失败');
        toast.error('AI 日志分析诊断失败');
      } finally {
        if (!controller.signal.aborted) {
          setDiagRunning(false);
        }
        if (diagAbortRef.current === controller) {
          diagAbortRef.current = null;
        }
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
