'use client';

// QwenPaw worker runtime config — legacy `runtime-config` panel.
//
// 1:1 port of the workbench plugin `WorkerRuntimeConfigView` + `Core` user
// capabilities onto dashboard primitives (Card / Tabs / Input / Select /
// Switch). The plugin routes QwenPaw through the legacy
// `GET/PUT /api/v1/workers/{name}/runtime-config` end; the dashboard's
// member-config *surface* only knows openclaw + hermes, which is why QwenPaw
// used to show "endpoint unsupported" here.
//
// Write contract (see lib/qwenpaw-runtime-config.ts):
//   · PUT only the changed top-level keys, If-Match = the ETag read via GET;
//   · 409/412/428 stale · 403 L2 whitelist / missing token · 400 rejected ·
//     503 non-embedded mode — each surfaces its own honest copy;
//   · after a successful write the process still runs the old values until it
//     restarts, so the panel shows 「已写入，重启后生效」 with an explicit
//     restart action (POST .../runtime-config/restart — never automatic).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { restartWorkerForConfig, describeRestartError } from '@/lib/worker-config-apply';
import {
  buildRuntimeConfigDiff,
  num,
  parseLoopGates,
  type DoomStageDraft,
  type EditMap,
  type EditValue,
  type Rc,
} from '@/lib/qwenpaw-runtime-config-model';
import {
  describeQwenpawLoadError,
  describeQwenpawWriteError,
  fetchQwenpawRuntimeConfig,
  isStaleConfigError,
  putQwenpawRuntimeConfig,
} from '@/lib/qwenpaw-runtime-config';
import {
  buildCustomLoopFromTemplate,
  createWorkerLoopCustom,
  deleteWorkerLoopCustom,
  fetchWorkerLoopCustoms,
  fetchWorkerLoopModes,
  updateWorkerLoopCustom,
  LOOP_GATE_DEFS,
  LOOP_TEMPLATE_LABELS,
  LOOP_TEMPLATES,
  type WorkerLoopCustomMode,
  type WorkerLoopModeInfo,
} from '@/lib/qwenpaw-loops';

type Banner = { kind: 'ok' | 'warn' | 'err' | 'info'; text: string };

export interface QwenpawRuntimeConfigPanelProps {
  workerName: string;
  /** L1 write permission (dashboard level 3). The controller still enforces
   * its own RBAC: L2 writes outside the whitelist answer 403. */
  canWrite?: boolean;
  onChanged?: () => void;
}

function asObject(v: unknown): Rc {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rc) : {};
}

/** Mask credentials inside the read-only memory JSON view (never dump a
 * password/secret back to the page). */
function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === 'object') {
    const out: Rc = {};
    for (const [key, entry] of Object.entries(value as Rc)) {
      out[key] = /pass(word)?|secret|token|api[_-]?key|credential|auth/i.test(key)
        ? '***'
        : maskSensitive(entry);
    }
    return out;
  }
  return value;
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/40 py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{label}</p>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      {title ? <h4 className="mb-1.5 text-xs font-semibold">{title}</h4> : null}
      {children}
    </section>
  );
}

export function QwenpawRuntimeConfigPanel({
  workerName,
  canWrite = true,
  onChanged,
}: QwenpawRuntimeConfigPanelProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [config, setConfig] = useState<Rc | null>(null);
  const [etag, setEtag] = useState<string | null>(null);

  const [edits, setEdits] = useState<EditMap>({});
  const [doomStages, setDoomStages] = useState<DoomStageDraft[] | null>(null);
  const [loopJson, setLoopJson] = useState<string | null>(null);
  const [loopJsonOpen, setLoopJsonOpen] = useState(false);
  const [memJsonOpen, setMemJsonOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const [loops, setLoops] = useState<WorkerLoopModeInfo[] | null>(null);
  const [customs, setCustoms] = useState<WorkerLoopCustomMode[] | null>(null);
  const [loopsLoading, setLoopsLoading] = useState(false);
  const [loopsError, setLoopsError] = useState('');
  const [loopMessage, setLoopMessage] = useState<Banner | null>(null);
  const [busyId, setBusyId] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [rawCreateOpen, setRawCreateOpen] = useState(false);
  const [newJson, setNewJson] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateCommand, setTemplateCommand] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [template, setTemplate] = useState('safe');
  const [templateGates, setTemplateGates] = useState<Record<string, boolean>>({
    iteration: true,
    token_budget: true,
    doom_loop: true,
    qualitative_rubric: true,
  });
  const [creating, setCreating] = useState(false);

  const resetDrafts = useCallback(() => {
    setEdits({});
    setDoomStages(null);
    setLoopJson(null);
    setLoopJsonOpen(false);
    setBanner(null);
  }, []);

  const loadLoops = useCallback(async () => {
    setLoopsLoading(true);
    setLoopsError('');
    try {
      const [catalog, custom] = await Promise.all([
        fetchWorkerLoopModes(workerName),
        fetchWorkerLoopCustoms(workerName),
      ]);
      setLoops(catalog);
      setCustoms(custom);
    } catch (err) {
      setLoops(null);
      setCustoms(null);
      setLoopsError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoopsLoading(false);
    }
  }, [workerName]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const snapshot = await fetchQwenpawRuntimeConfig(workerName);
      setConfig(snapshot.config);
      setEtag(snapshot.etag);
      resetDrafts();
      void loadLoops();
    } catch (err) {
      setConfig(null);
      setEtag(null);
      setLoadError(describeQwenpawLoadError(err));
    } finally {
      setLoading(false);
    }
  }, [workerName, resetDrafts, loadLoops]);

  useEffect(() => {
    // Defer past the effect's synchronous phase (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const setEdit = useCallback((key: string, value: EditValue | null) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
    setBanner(null);
  }, []);

  const valueOf = useCallback(
    (key: string, fallback: unknown): string => {
      if (edits[key] !== undefined) return String(edits[key]);
      return fallback === null || fallback === undefined ? '' : String(fallback);
    },
    [edits],
  );

  const boolOf = useCallback(
    (key: string, fallback: boolean): boolean => {
      return edits[key] === undefined ? fallback : edits[key] === true;
    },
    [edits],
  );

  const gates = useMemo(() => parseLoopGates(config?.loop), [config]);
  const stages = doomStages ?? gates.doomStages;
  // Keep a non-standard backend selectable without duplicating a built-in item
  // (Radix Select forbids two items with the same value).
  const memoryBackend = String(config?.memory_manager_backend || 'remelight');
  const extraMemoryBackend = ['remelight', 'adbpg'].includes(memoryBackend) ? null : memoryBackend;
  const contextBackend = String(config?.context_manager_backend || 'light');
  const extraContextBackend = ['light'].includes(contextBackend) ? null : contextBackend;

  const { diff, invalid } = useMemo(
    () => buildRuntimeConfigDiff(config ?? {}, edits, { loopJson, doomStages }),
    [config, edits, loopJson, doomStages],
  );
  const changedCount = Object.keys(diff).length;
  const noWrite = !canWrite || loading || !config;

  const handleReset = useCallback(() => {
    setEdits({});
    setDoomStages(null);
    setLoopJson(null);
    setBanner(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!config || noWrite || saving) return;
    const result = buildRuntimeConfigDiff(config, edits, { loopJson, doomStages });
    if (result.invalid) {
      setBanner({ kind: 'err', text: result.invalid });
      return;
    }
    if (Object.keys(result.diff).length === 0) {
      setBanner({ kind: 'info', text: '无改动' });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      await putQwenpawRuntimeConfig(workerName, result.diff, etag);
      // Refetch the authoritative merged values; a failed refetch must not
      // hide the successful write.
      try {
        const fresh = await fetchQwenpawRuntimeConfig(workerName);
        setConfig(fresh.config);
        setEtag(fresh.etag);
      } catch {
        /* keep the current snapshot */
      }
      setEdits({});
      setDoomStages(null);
      setLoopJson(null);
      setLoopJsonOpen(false);
      setNeedsRestart(true);
      setBanner({
        kind: 'ok',
        text: result.diff.loop
          ? '已保存——loop 配置变更将通知团队 Leader；重启后生效'
          : '已保存——重启后生效',
      });
      onChanged?.();
    } catch (err) {
      if (isStaleConfigError(err)) {
        setBanner({ kind: 'warn', text: describeQwenpawWriteError(err) });
      } else {
        setBanner({ kind: 'err', text: describeQwenpawWriteError(err) });
      }
    } finally {
      setSaving(false);
    }
  }, [config, noWrite, saving, edits, loopJson, doomStages, workerName, etag, onChanged]);

  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    setBanner(null);
    try {
      await restartWorkerForConfig(workerName);
      setNeedsRestart(false);
      setBanner({ kind: 'ok', text: '已发送重启，配置将重新加载' });
      onChanged?.();
    } catch (err) {
      setBanner({ kind: 'err', text: describeRestartError(err) });
    } finally {
      setRestarting(false);
    }
  }, [restarting, workerName, onChanged]);

  // ── Custom loop CRUD ────────────────────────────────────────
  const createFromTemplate = useCallback(async () => {
    const name = templateName.trim();
    const command = (templateCommand.trim() || name).replace(/^\/+/, '');
    if (!name) {
      setLoopMessage({ kind: 'err', text: '模式名不可为空' });
      return;
    }
    if ((customs ?? []).some((mode) => mode.slash_command === command)) {
      setLoopMessage({ kind: 'err', text: 'slash 命令已被占用' });
      return;
    }
    setCreating(true);
    setLoopMessage(null);
    try {
      await createWorkerLoopCustom(
        workerName,
        buildCustomLoopFromTemplate({
          name,
          slashCommand: command,
          description: templateDescription.trim() || '自定义 gate 管道（模板创建）',
          template,
          enabledGates: templateGates,
        }),
      );
      setCreateOpen(false);
      setTemplateName('');
      setTemplateCommand('');
      setTemplateDescription('');
      setLoopMessage({ kind: 'ok', text: '已按模板创建自定义模式' });
      void loadLoops();
    } catch (err) {
      setLoopMessage({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setCreating(false);
    }
  }, [
    templateName,
    templateCommand,
    templateDescription,
    template,
    templateGates,
    customs,
    workerName,
    loadLoops,
  ]);

  const createFromJson = useCallback(async () => {
    let parsed: WorkerLoopCustomMode;
    try {
      const body = JSON.parse(newJson) as unknown;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
      parsed = body as WorkerLoopCustomMode;
    } catch {
      setLoopMessage({ kind: 'err', text: 'loop 不是合法 JSON' });
      return;
    }
    setCreating(true);
    setLoopMessage(null);
    try {
      await createWorkerLoopCustom(workerName, parsed);
      setRawCreateOpen(false);
      setNewJson('');
      setLoopMessage({ kind: 'ok', text: '已创建' });
      void loadLoops();
    } catch (err) {
      setLoopMessage({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setCreating(false);
    }
  }, [newJson, workerName, loadLoops]);

  const toggleCustom = useCallback(
    async (mode: WorkerLoopCustomMode, enabled: boolean) => {
      setBusyId(mode.id);
      setLoopMessage(null);
      try {
        // PUT replaces the whole object; we hold the full GET payload.
        await updateWorkerLoopCustom(workerName, { ...mode, enabled });
        setLoopMessage({ kind: 'ok', text: '已更新' });
        void loadLoops();
      } catch (err) {
        setLoopMessage({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
      } finally {
        setBusyId('');
      }
    },
    [workerName, loadLoops],
  );

  const removeCustom = useCallback(
    async (mode: WorkerLoopCustomMode) => {
      setBusyId(mode.id);
      setLoopMessage(null);
      try {
        await deleteWorkerLoopCustom(workerName, mode.id);
        setLoopMessage({ kind: 'ok', text: '已删除' });
        void loadLoops();
      } catch (err) {
        setLoopMessage({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
      } finally {
        setBusyId('');
      }
    },
    [workerName, loadLoops],
  );

  const remeConfig = asObject(config?.reme_light_memory_config);
  const memoryJson = useMemo(
    () =>
      JSON.stringify(
        maskSensitive({
          reme_light_memory_config: config?.reme_light_memory_config ?? null,
          adbpg_memory_config: config?.adbpg_memory_config ?? null,
        }),
        null,
        2,
      ),
    [config],
  );

  if (loading && !config) {
    return (
      <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        运行配置加载中…
      </p>
    );
  }

  if (loadError && !config) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p>读取运行配置失败：{loadError}</p>
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  if (!config) return null;

  const bannerClass = (kind: Banner['kind']) =>
    kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
      : kind === 'warn'
        ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
        : kind === 'info'
          ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200'
          : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300';

  const renderBanner = (entry: Banner) => (
    <p className={`flex items-start gap-1.5 rounded-md border p-2 text-xs ${bannerClass(entry.kind)}`}>
      {entry.kind === 'ok' ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : entry.kind === 'warn' ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">{entry.text}</span>
    </p>
  );

  return (
    <div className="space-y-3">
      {!canWrite ? (
        <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          只读：运行配置需要 L1 写权限（团队 Leader / 策略限制）
        </p>
      ) : null}

      {banner ? renderBanner(banner) : null}
      {loadError && config ? renderBanner({ kind: 'err', text: `刷新失败：${loadError}` }) : null}

      {needsRestart ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="min-w-0 flex-1">已写入，重启后生效</span>
          <Button
            size="sm"
            className="h-11 shrink-0 px-4"
            disabled={restarting}
            onClick={() => void handleRestart()}
          >
            {restarting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCw className="mr-1 h-4 w-4" aria-hidden="true" />
            )}
            立即重启
          </Button>
        </div>
      ) : null}

      <Tabs defaultValue="basic">
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="basic" className="shrink-0 px-3 text-xs">
            ReAct 智能体
          </TabsTrigger>
          <TabsTrigger value="loop" className="shrink-0 px-3 text-xs">
            智能体 Loop 设置
          </TabsTrigger>
          <TabsTrigger value="retry" className="shrink-0 px-3 text-xs">
            LLM 自动重试
          </TabsTrigger>
          <TabsTrigger value="rate" className="shrink-0 px-3 text-xs">
            LLM 并发限流
          </TabsTrigger>
          <TabsTrigger value="ctx" className="shrink-0 px-3 text-xs">
            上下文管理
          </TabsTrigger>
          <TabsTrigger value="mem" className="shrink-0 px-3 text-xs">
            长期记忆
          </TabsTrigger>
        </TabsList>

        {/* ── ReAct 智能体 ───────────────────────────────── */}
        <TabsContent value="basic">
          <SectionCard>
            <FieldRow
              label="最大迭代"
              hint="单次任务最大 LLM 迭代轮数。唯一编辑入口在 智能体 Loop 设置 → 迭代限制；此处只读展示。"
            >
              <span className="text-sm" data-testid="max-iters">
                {String(gates.iterationMax ?? num(config.max_iters) ?? '-')}
              </span>
            </FieldRow>
            <FieldRow label="最大输入长度" hint="模型上下文窗口上限（max_input_length，≥1000 词元）。L1-only 键。">
              <Input
                type="number"
                min={1000}
                aria-label="最大输入长度"
                className="h-9 w-40 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('max_input_length', config.max_input_length)}
                onChange={(event) => setEdit('max_input_length', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Shell 超时" hint="单次 shell 命令超时（秒）。L1-only 键。">
              <Input
                type="number"
                min={1}
                max={86400}
                aria-label="Shell 超时"
                className="h-9 w-40 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('shell_command_timeout', config.shell_command_timeout)}
                onChange={(event) => setEdit('shell_command_timeout', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Shell 可执行文件" hint="shell_command_executable；留空回退 $SHELL / /bin/sh。">
              <Input
                aria-label="Shell 可执行文件"
                className="h-9 w-56 font-mono text-sm"
                placeholder="默认（/bin/sh）"
                disabled={noWrite}
                value={valueOf('shell_command_executable', config.shell_command_executable)}
                onChange={(event) => setEdit('shell_command_executable', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="自动标题" hint="会话自动标题（auto_title_config.enabled）。L1-only 键。">
              <Switch
                aria-label="自动标题"
                checked={boolOf('auto_title', asObject(config.auto_title_config).enabled === true)}
                disabled={noWrite}
                onCheckedChange={(checked) => setEdit('auto_title', checked)}
              />
            </FieldRow>
            <FieldRow label="记忆后端" hint="memory_manager_backend：remelight=轻量本地记忆，adbpg=AnalyticDB PG。">
              <Select
                value={valueOf('memory_manager_backend', config.memory_manager_backend || 'remelight')}
                disabled={noWrite}
                onValueChange={(next) => setEdit('memory_manager_backend', next)}
              >
                <SelectTrigger aria-label="记忆后端" className="h-9 w-52 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remelight">remelight（轻量本地）</SelectItem>
                  <SelectItem value="adbpg">adbpg（AnalyticDB PG）</SelectItem>
                  {extraMemoryBackend ? (
                    <SelectItem value={extraMemoryBackend}>{extraMemoryBackend}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </FieldRow>
          </SectionCard>
        </TabsContent>

        {/* ── 智能体 Loop 设置 ───────────────────────────── */}
        <TabsContent value="loop">
          <div className="space-y-2">
            <SectionCard title="Loop 模板">
              <p className="mb-2 text-[11px] text-muted-foreground">
                选择内置模板，或添加自己的（按模板生成自定义模式）。模板设计：QwenPaw 上游。
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {Object.entries(LOOP_TEMPLATE_LABELS).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`模板 ${label}`}
                    onClick={() => {
                      setTemplate(id);
                      const next: Record<string, boolean> = {};
                      for (const gate of LOOP_TEMPLATES[id] ?? []) next[gate] = true;
                      setTemplateGates(next);
                    }}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      template === id ? 'border-amber-500 text-amber-700 dark:text-amber-400' : ''
                    }`}
                  >
                    {label} <span className="opacity-60">{id}</span>
                  </button>
                ))}
              </div>
              {(LOOP_TEMPLATES[template] ?? []).length === 0 ? (
                <p className="text-[11px] text-muted-foreground">空管道——创建后再逐个添加 gate（高级 JSON）。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(LOOP_TEMPLATES[template] ?? []).map((gate) => (
                    <label key={gate} className="flex items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={templateGates[gate] !== false}
                        onChange={(event) =>
                          setTemplateGates((prev) => ({ ...prev, [gate]: event.target.checked }))
                        }
                      />
                      {LOOP_GATE_DEFS[gate].title}
                      <span className="opacity-60">{gate}</span>
                    </label>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-9 text-xs"
                onClick={() => setCreateOpen((prev) => !prev)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                按模板创建自定义模式
              </Button>
              {createOpen ? (
                <div className="mt-2 space-y-2 rounded-md border border-dashed p-2">
                  <Input
                    aria-label="自定义 Loop 模式名"
                    className="h-9 text-sm"
                    placeholder="my-mode"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                  />
                  <Input
                    aria-label="自定义 Loop slash 命令"
                    className="h-9 text-sm"
                    placeholder={templateName.trim() || 'custom-mode'}
                    value={templateCommand}
                    onChange={(event) => setTemplateCommand(event.target.value)}
                  />
                  <Input
                    aria-label="自定义 Loop 描述"
                    className="h-9 text-sm"
                    placeholder="自定义 gate 管道（模板创建）"
                    value={templateDescription}
                    onChange={(event) => setTemplateDescription(event.target.value)}
                  />
                  <Button
                    size="sm"
                    className="h-9 text-xs"
                    disabled={creating}
                    onClick={() => void createFromTemplate()}
                  >
                    {creating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    创建
                  </Button>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="Default 模式 · gate 管道">
              <div className="space-y-3">
                <div className="rounded-md border p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium">迭代限制</span>
                    <Switch
                      aria-label="启用迭代限制"
                      checked={boolOf('iteration_enabled', gates.iterationEnabled)}
                      disabled={noWrite}
                      onCheckedChange={(checked) => setEdit('iteration_enabled', checked)}
                    />
                  </div>
                  <FieldRow label="最大迭代" hint="1..500；保存时同步 legacy max_iters。">
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      aria-label="迭代上限"
                      className="h-9 w-36 font-mono text-sm"
                      disabled={noWrite}
                      value={valueOf('iteration_max', gates.iterationMax ?? 40)}
                      onChange={(event) => setEdit('iteration_max', event.target.value)}
                    />
                  </FieldRow>
                  {gates.iterationMax === null ? (
                    <p className="text-[10.5px] text-muted-foreground">未显式配置——显示运行时默认 40，保存后落库</p>
                  ) : null}
                </div>

                <div className="rounded-md border p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium">重复保护</span>
                    <Switch
                      aria-label="启用重复保护"
                      checked={boolOf('doom_enabled', gates.doomEnabled)}
                      disabled={noWrite}
                      onCheckedChange={(checked) => setEdit('doom_enabled', checked)}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FieldRow label="检测窗口" hint="≥2">
                      <Input
                        type="number"
                        min={2}
                        aria-label="重复检测窗口"
                        className="h-9 w-28 font-mono text-sm"
                        disabled={noWrite}
                        value={valueOf('doom_window', gates.doomWindow ?? '')}
                        onChange={(event) => setEdit('doom_window', event.target.value)}
                      />
                    </FieldRow>
                    <FieldRow label="相似度阈值" hint="0..1">
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        aria-label="相似度阈值"
                        className="h-9 w-28 font-mono text-sm"
                        disabled={noWrite}
                        value={valueOf('doom_threshold', gates.doomThreshold ?? '')}
                        onChange={(event) => setEdit('doom_threshold', event.target.value)}
                      />
                    </FieldRow>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">干预规则</p>
                    {stages.map((stage, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-1.5">
                        <Input
                          type="number"
                          min={1}
                          aria-label={`重复规则 ${index + 1} 重复次数`}
                          className="h-8 w-20 font-mono text-xs"
                          disabled={noWrite}
                          value={stage.after}
                          onChange={(event) =>
                            setDoomStages(
                              stages.map((entry, i) =>
                                i === index ? { ...entry, after: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                        <Select
                          value={stage.action}
                          disabled={noWrite}
                          onValueChange={(next) =>
                            setDoomStages(
                              stages.map((entry, i) =>
                                i === index
                                  ? { ...entry, action: next as DoomStageDraft['action'] }
                                  : entry,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            aria-label={`重复规则 ${index + 1} 动作`}
                            className="h-8 w-32 text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="modify_prompt">注入提醒</SelectItem>
                            <SelectItem value="stop">终止任务</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          aria-label={`重复规则 ${index + 1} 提示词`}
                          className="h-8 min-w-40 flex-1 text-xs"
                          placeholder="提示词（注入提醒必填）"
                          disabled={noWrite}
                          value={stage.prompt}
                          onChange={(event) =>
                            setDoomStages(
                              stages.map((entry, i) =>
                                i === index ? { ...entry, prompt: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-red-600"
                          aria-label={`移除重复规则 ${index + 1}`}
                          disabled={noWrite}
                          onClick={() => setDoomStages(stages.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 w-full text-xs"
                      disabled={noWrite}
                      onClick={() =>
                        setDoomStages([
                          ...stages,
                          { after: '3', action: 'modify_prompt', prompt: '' },
                        ])
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      添加规则
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium">完成质量检查</span>
                    <Switch
                      aria-label="启用完成质量检查"
                      checked={boolOf('rubric_enabled', gates.rubricEnabled)}
                      disabled={noWrite}
                      onCheckedChange={(checked) => setEdit('rubric_enabled', checked)}
                    />
                  </div>
                  <FieldRow label="Rubric 提示词">
                    <Textarea
                      aria-label="Rubric 提示词"
                      rows={2}
                      className="min-h-16 w-full min-w-56 text-xs"
                      disabled={noWrite}
                      value={valueOf('rubric_prompt', gates.rubricPrompt)}
                      onChange={(event) => setEdit('rubric_prompt', event.target.value)}
                    />
                  </FieldRow>
                  <FieldRow label="最大干预次数" hint="1..10">
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      aria-label="Rubric 最大干预次数"
                      className="h-9 w-28 font-mono text-sm"
                      disabled={noWrite}
                      value={valueOf('rubric_interventions', gates.rubricInterventions ?? '')}
                      onChange={(event) => setEdit('rubric_interventions', event.target.value)}
                    />
                  </FieldRow>
                </div>

                <div className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-medium">Goal 模式 · 内置参数</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FieldRow label="最大迭代" hint="1..500">
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        aria-label="Goal 最大迭代"
                        className="h-9 w-28 font-mono text-sm"
                        disabled={noWrite}
                        value={valueOf('goal_max_iterations', gates.goalMaxIters ?? '')}
                        onChange={(event) => setEdit('goal_max_iterations', event.target.value)}
                      />
                    </FieldRow>
                    <FieldRow label="词元预算">
                      <Input
                        type="number"
                        min={1}
                        aria-label="Goal 词元预算"
                        className="h-9 w-32 font-mono text-sm"
                        disabled={noWrite}
                        value={valueOf('goal_max_tokens', gates.goalMaxTokens ?? '')}
                        onChange={(event) => setEdit('goal_max_tokens', event.target.value)}
                      />
                    </FieldRow>
                  </div>
                </div>

                <div className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-medium">Mission 模式 · 内置参数</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FieldRow label="最大迭代" hint="1..100">
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        aria-label="Mission 最大迭代"
                        className="h-9 w-28 font-mono text-sm"
                        disabled={noWrite}
                        value={valueOf('mission_max_iterations', gates.missionMaxIters ?? '')}
                        onChange={(event) => setEdit('mission_max_iterations', event.target.value)}
                      />
                    </FieldRow>
                    <FieldRow label="每个 Story 最大重试次数" hint="0..10">
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        aria-label="Mission 每个 Story 最大重试次数"
                        className="h-9 w-28 font-mono text-sm"
                        disabled={noWrite}
                        value={valueOf('mission_max_retries_per_story', gates.missionMaxRetries ?? '')}
                        onChange={(event) => setEdit('mission_max_retries_per_story', event.target.value)}
                      />
                    </FieldRow>
                  </div>
                  <FieldRow label="验证说明">
                    <Input
                      aria-label="Mission 验证说明"
                      className="h-9 w-full min-w-56 text-sm"
                      disabled={noWrite}
                      value={valueOf(
                        'mission_verify_instructions',
                        gates.missionVerifyInstructions,
                      )}
                      onChange={(event) => setEdit('mission_verify_instructions', event.target.value)}
                    />
                  </FieldRow>
                  <FieldRow label="验证命令">
                    <Input
                      aria-label="Mission 验证命令"
                      className="h-9 w-full min-w-56 font-mono text-sm"
                      disabled={noWrite}
                      value={valueOf('mission_verify_command', gates.missionVerifyCommand)}
                      onChange={(event) => setEdit('mission_verify_command', event.target.value)}
                    />
                  </FieldRow>
                </div>

                <div className="rounded-md border border-dashed p-2">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => {
                      if (loopJson === null) setLoopJson(JSON.stringify(config.loop ?? null, null, 2));
                      setLoopJsonOpen((prev) => !prev);
                    }}
                  >
                    {loopJsonOpen ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
                    高级：编辑整块 JSON
                  </Button>
                  {loopJsonOpen ? (
                    <div className="mt-2">
                      <Textarea
                        aria-label="loop JSON"
                        rows={10}
                        className="min-h-40 w-full font-mono text-xs"
                        disabled={noWrite}
                        value={loopJson ?? ''}
                        onChange={(event) => setLoopJson(event.target.value)}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        loop 为整块替换语义——保存后整个 loop 对象以此 JSON 为准（覆盖上方 gate 编辑）；loop 变更将通知团队 Leader。
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Loop 模式">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => void loadLoops()}
                  disabled={loopsLoading}
                >
                  {loopsLoading ? '刷新中…' : '刷新'}
                </Button>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 text-xs"
                  onClick={() => setRawCreateOpen((prev) => !prev)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  粘贴 JSON 新建
                </Button>
              </div>
              {loopMessage ? renderBanner(loopMessage) : null}
              {loopsError ? (
                renderBanner({ kind: 'info', text: `loop 模式不可用：${loopsError}` })
              ) : (
                <>
                  {loops ? (
                    <div className="mb-2">
                      <p className="mb-1 text-[11px] text-muted-foreground">模式目录</p>
                      <div className="flex flex-wrap gap-1">
                        {loops.map((mode) => (
                          <Badge key={mode.id} variant="secondary" className="text-[10.5px]">
                            {mode.name}
                            {mode.slash_command ? ` /${mode.slash_command}` : ''}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <p className="mb-1 text-[11px] text-muted-foreground">自定义 Loop</p>
                  {customs && customs.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">该 Worker 暂无自定义 loop</p>
                  ) : null}
                  {customs?.map((mode) => {
                    const modeGates = Array.isArray(mode.gates) ? mode.gates : [];
                    const enabledGates = modeGates.filter((gate) => gate.enabled).length;
                    return (
                      <div
                        key={mode.id}
                        className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1.5 text-xs last:border-0"
                      >
                        <Switch
                          aria-label={`启用自定义 Loop ${mode.id}`}
                          checked={mode.enabled === true}
                          disabled={busyId === mode.id}
                          onCheckedChange={(checked) => void toggleCustom(mode, checked)}
                        />
                        <span className="font-mono font-medium">{mode.id}</span>
                        <span className="text-muted-foreground">{mode.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          /{mode.slash_command}
                        </Badge>
                        <span className="text-[10.5px] text-muted-foreground">
                          门禁 {modeGates.length} 个（启用 {enabledGates}）
                        </span>
                        <div className="flex-1" />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs text-red-600"
                          aria-label={`删除自定义 Loop ${mode.id}`}
                          disabled={busyId === mode.id}
                          onClick={() => void removeCustom(mode)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                  {rawCreateOpen ? (
                    <div className="mt-2">
                      <Textarea
                        aria-label="自定义 Loop JSON"
                        rows={8}
                        className="min-h-32 w-full font-mono text-xs"
                        placeholder="新自定义 loop 完整 JSON（字段：id / name / slash_command / enabled / gates）"
                        value={newJson}
                        onChange={(event) => setNewJson(event.target.value)}
                      />
                      <p className="mt-1 text-[10.5px] text-muted-foreground">
                        id 与 slash_command 须小写字母/数字/_/-；重名或 slash 冲突 409，管道校验失败 422。
                      </p>
                      <Button
                        size="sm"
                        className="mt-1 h-9 text-xs"
                        disabled={creating}
                        onClick={() => void createFromJson()}
                      >
                        创建
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </SectionCard>
          </div>
        </TabsContent>

        {/* ── LLM 自动重试 ──────────────────────────────── */}
        <TabsContent value="retry">
          <SectionCard>
            <FieldRow label="启用自动重试" hint="LLM 调用失败（限流/超时/5xx）时自动重试。">
              <Switch
                aria-label="启用自动重试"
                checked={boolOf('llm_retry_enabled', config.llm_retry_enabled === true)}
                disabled={noWrite}
                onCheckedChange={(checked) => setEdit('llm_retry_enabled', checked)}
              />
            </FieldRow>
            <FieldRow label="最大重试次数" hint="llm_max_retries">
              <Input
                type="number"
                min={1}
                aria-label="最大重试次数"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite || boolOf('llm_retry_enabled', config.llm_retry_enabled === true) === false}
                value={valueOf('llm_max_retries', config.llm_max_retries)}
                onChange={(event) => setEdit('llm_max_retries', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="退避基数（秒）" hint="第 n 次重试前等待 ≈ 基数 × 2^(n-1)">
              <Input
                type="number"
                min={0}
                step={0.5}
                aria-label="退避基数"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite || boolOf('llm_retry_enabled', config.llm_retry_enabled === true) === false}
                value={valueOf('llm_backoff_base', config.llm_backoff_base)}
                onChange={(event) => setEdit('llm_backoff_base', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="退避上限（秒）" hint="须 ≥ 退避基数">
              <Input
                type="number"
                min={0}
                step={0.5}
                aria-label="退避上限"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite || boolOf('llm_retry_enabled', config.llm_retry_enabled === true) === false}
                value={valueOf('llm_backoff_cap', config.llm_backoff_cap)}
                onChange={(event) => setEdit('llm_backoff_cap', event.target.value)}
              />
            </FieldRow>
          </SectionCard>
        </TabsContent>

        {/* ── LLM 并发限流（L1-only）────────────────────── */}
        <TabsContent value="rate">
          <SectionCard>
            {!canWrite ? (
              <p className="mb-2 text-[11px] text-muted-foreground">
                L1-only 字段——需要 Controller 管理 token。
              </p>
            ) : null}
            <FieldRow label="LLM 并发上限" hint="llm_max_concurrent · 1..10000">
              <Input
                type="number"
                min={1}
                max={10000}
                aria-label="LLM 并发上限"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('llm_max_concurrent', config.llm_max_concurrent)}
                onChange={(event) => setEdit('llm_max_concurrent', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="LLM QPM" hint="每分钟请求上限，0=不限制">
              <Input
                type="number"
                min={0}
                max={1000000}
                aria-label="LLM QPM"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('llm_max_qpm', config.llm_max_qpm)}
                onChange={(event) => setEdit('llm_max_qpm', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="限速等待（秒）" hint="触发限速时等待秒数">
              <Input
                type="number"
                min={0}
                max={3600}
                aria-label="限速等待"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('llm_rate_limit_pause', config.llm_rate_limit_pause)}
                onChange={(event) => setEdit('llm_rate_limit_pause', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="限速抖动（秒）" hint="限速等待的随机抖动">
              <Input
                type="number"
                min={0}
                max={3600}
                aria-label="限速抖动"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('llm_rate_limit_jitter', config.llm_rate_limit_jitter)}
                onChange={(event) => setEdit('llm_rate_limit_jitter', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="槽位获取超时（秒）" hint="llm_acquire_timeout">
              <Input
                type="number"
                min={1}
                max={3600}
                aria-label="槽位获取超时"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('llm_acquire_timeout', config.llm_acquire_timeout)}
                onChange={(event) => setEdit('llm_acquire_timeout', event.target.value)}
              />
            </FieldRow>
          </SectionCard>
        </TabsContent>

        {/* ── 上下文管理（L1-only）──────────────────────── */}
        <TabsContent value="ctx">
          <SectionCard>
            {!canWrite ? (
              <p className="mb-2 text-[11px] text-muted-foreground">
                L1-only 字段——需要 Controller 管理 token。
              </p>
            ) : null}
            <FieldRow label="上下文后端" hint="context_manager_backend">
              <Select
                value={valueOf('context_manager_backend', config.context_manager_backend || 'light')}
                disabled={noWrite}
                onValueChange={(next) => setEdit('context_manager_backend', next)}
              >
                <SelectTrigger aria-label="上下文后端" className="h-9 w-48 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">light（滚动上下文）</SelectItem>
                  {extraContextBackend ? (
                    <SelectItem value={extraContextBackend}>{extraContextBackend}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="词元估算除数" hint="词元数 = 字符数 ÷ 该值">
              <Input
                type="number"
                min={0.5}
                max={10000}
                step={0.5}
                aria-label="词元估算除数"
                className="h-9 w-32 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'token_count_estimate_divisor',
                  asObject(config.light_context_config).token_count_estimate_divisor,
                )}
                onChange={(event) => setEdit('token_count_estimate_divisor', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="压缩启用" hint="context_compact_config.enabled">
              <Switch
                aria-label="压缩启用"
                checked={boolOf(
                  'context_compact_enabled',
                  asObject(asObject(config.light_context_config).context_compact_config).enabled === true,
                )}
                disabled={noWrite}
                onCheckedChange={(checked) => setEdit('context_compact_enabled', checked)}
              />
            </FieldRow>
            <FieldRow label="压缩阈值比例" hint="(0,1)">
              <Input
                type="number"
                min={0.05}
                max={0.99}
                step={0.05}
                aria-label="压缩阈值比例"
                className="h-9 w-32 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'compact_threshold_ratio',
                  asObject(asObject(config.light_context_config).context_compact_config)
                    .compact_threshold_ratio,
                )}
                onChange={(event) => setEdit('compact_threshold_ratio', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="保留阈值比例" hint="(0,1)">
              <Input
                type="number"
                min={0.05}
                max={0.99}
                step={0.05}
                aria-label="保留阈值比例"
                className="h-9 w-32 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'reserve_threshold_ratio',
                  asObject(asObject(config.light_context_config).context_compact_config)
                    .reserve_threshold_ratio,
                )}
                onChange={(event) => setEdit('reserve_threshold_ratio', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="工具结果裁剪" hint="tool_result_pruning_config.enabled">
              <Switch
                aria-label="工具结果裁剪"
                checked={boolOf(
                  'pruning_enabled',
                  asObject(asObject(config.light_context_config).tool_result_pruning_config)
                    .enabled === true,
                )}
                disabled={noWrite}
                onCheckedChange={(checked) => setEdit('pruning_enabled', checked)}
              />
            </FieldRow>
            <FieldRow label="近期保留条数" hint="pruning_recent_n">
              <Input
                type="number"
                min={0}
                max={100000}
                aria-label="近期保留条数"
                className="h-9 w-32 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'pruning_recent_n',
                  asObject(asObject(config.light_context_config).tool_result_pruning_config)
                    .pruning_recent_n,
                )}
                onChange={(event) => setEdit('pruning_recent_n', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="旧消息上限（字节）" hint="pruning_old_msg_max_bytes">
              <Input
                type="number"
                min={0}
                max={1000000000}
                aria-label="旧消息上限"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'pruning_old_msg_max_bytes',
                  asObject(asObject(config.light_context_config).tool_result_pruning_config)
                    .pruning_old_msg_max_bytes,
                )}
                onChange={(event) => setEdit('pruning_old_msg_max_bytes', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="近期消息上限（字节）" hint="pruning_recent_msg_max_bytes">
              <Input
                type="number"
                min={0}
                max={1000000000}
                aria-label="近期消息上限"
                className="h-9 w-36 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'pruning_recent_msg_max_bytes',
                  asObject(asObject(config.light_context_config).tool_result_pruning_config)
                    .pruning_recent_msg_max_bytes,
                )}
                onChange={(event) => setEdit('pruning_recent_msg_max_bytes', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="offload 保留天数" hint="offload_retention_days">
              <Input
                type="number"
                min={1}
                max={3650}
                aria-label="offload 保留天数"
                className="h-9 w-32 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'offload_retention_days',
                  asObject(asObject(config.light_context_config).tool_result_pruning_config)
                    .offload_retention_days,
                )}
                onChange={(event) => setEdit('offload_retention_days', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="裁剪豁免扩展名" hint="逗号分隔，如 .md, .json">
              <Input
                aria-label="裁剪豁免扩展名"
                className="h-9 w-56 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'exempt_file_extensions',
                  (
                    asObject(asObject(config.light_context_config).tool_result_pruning_config)
                      .exempt_file_extensions as string[] | undefined
                  )?.join(', ') ?? '',
                )}
                onChange={(event) => setEdit('exempt_file_extensions', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="裁剪豁免工具" hint="逗号分隔">
              <Input
                aria-label="裁剪豁免工具"
                className="h-9 w-56 font-mono text-sm"
                disabled={noWrite}
                value={valueOf(
                  'exempt_tool_names',
                  (
                    asObject(asObject(config.light_context_config).tool_result_pruning_config)
                      .exempt_tool_names as string[] | undefined
                  )?.join(', ') ?? '',
                )}
                onChange={(event) => setEdit('exempt_tool_names', event.target.value)}
              />
            </FieldRow>
          </SectionCard>
        </TabsContent>

        {/* ── 长期记忆 ─────────────────────────────────── */}
        <TabsContent value="mem">
          <SectionCard>
            <FieldRow label="记忆后端" hint="memory_manager_backend">
              <Select
                value={valueOf('memory_manager_backend', config.memory_manager_backend || 'remelight')}
                disabled={noWrite}
                onValueChange={(next) => setEdit('memory_manager_backend', next)}
              >
                <SelectTrigger aria-label="长期记忆后端" className="h-9 w-52 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remelight">remelight（轻量本地）</SelectItem>
                  <SelectItem value="adbpg">adbpg（AnalyticDB PG）</SelectItem>
                  {extraMemoryBackend ? (
                    <SelectItem value={extraMemoryBackend}>{extraMemoryBackend}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="压缩时摘要" hint="summarize_when_compact">
              <Switch
                aria-label="压缩时摘要"
                checked={boolOf('reme_summarize_when_compact', remeConfig.summarize_when_compact === true)}
                disabled={noWrite}
                onCheckedChange={(checked) => setEdit('reme_summarize_when_compact', checked)}
              />
            </FieldRow>
            <FieldRow label="收件箱推送" hint="inbox_push_enabled">
              <Switch
                aria-label="收件箱推送"
                checked={boolOf('reme_inbox_push_enabled', remeConfig.inbox_push_enabled === true)}
                disabled={noWrite}
                onCheckedChange={(checked) => setEdit('reme_inbox_push_enabled', checked)}
              />
            </FieldRow>
            <FieldRow label="自动记忆间隔（分钟）" hint="auto_memory_interval · 1..1440">
              <Input
                type="number"
                min={1}
                max={1440}
                aria-label="自动记忆间隔"
                className="h-9 w-32 font-mono text-sm"
                disabled={noWrite}
                value={valueOf('reme_auto_memory_interval', remeConfig.auto_memory_interval)}
                onChange={(event) => setEdit('reme_auto_memory_interval', event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Dream 定时任务" hint="dream_cron_enabled + dream_cron（cron 表达式）">
              <Switch
                aria-label="启用 Dream 定时任务"
                checked={boolOf('reme_dream_cron_enabled', remeConfig.dream_cron_enabled === true)}
                disabled={noWrite}
                onCheckedChange={(checked) => setEdit('reme_dream_cron_enabled', checked)}
              />
              <Input
                aria-label="Dream cron 表达式"
                className="h-9 w-40 font-mono text-sm"
                placeholder="0 23 * * *"
                disabled={noWrite}
                value={valueOf('reme_dream_cron', remeConfig.dream_cron)}
                onChange={(event) => setEdit('reme_dream_cron', event.target.value)}
              />
            </FieldRow>
            <div className="pt-1">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setMemJsonOpen((prev) => !prev)}
              >
                {memJsonOpen ? '隐藏配置 JSON' : '查看配置 JSON'}
              </Button>
              {memJsonOpen ? (
                <pre className="mt-1.5 max-h-44 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[10.5px] break-all whitespace-pre-wrap">
                  {memoryJson}
                </pre>
              ) : null}
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      {invalid ? (
        <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {invalid}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          className="h-11 min-w-[96px] px-4"
          disabled={noWrite || saving || changedCount === 0}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="mr-1 h-4 w-4" aria-hidden="true" />
          )}
          保存改动
        </Button>
        <Button
          variant="outline"
          className="h-11 px-4"
          disabled={saving || changedCount === 0}
          onClick={handleReset}
        >
          <RefreshCw className="mr-1 h-4 w-4 -scale-x-100" aria-hidden="true" />
          重置
        </Button>
        <Button
          variant="ghost"
          className="h-11 px-3"
          disabled={saving}
          onClick={() => void load()}
        >
          <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />
          刷新
        </Button>
        {changedCount > 0 ? (
          <Badge variant="outline" className="ml-auto border-amber-500/50 text-xs text-amber-700 dark:text-amber-400">
            已改 {changedCount} 项
          </Badge>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">
            {etag ? `配置版本 ${etag.slice(0, 8)}` : 'QwenPaw 运行配置'}
          </span>
        )}
      </div>
    </div>
  );
}

export default QwenpawRuntimeConfigPanel;
