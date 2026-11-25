'use client';

// Worker runtime config (surface-driven) — ported from the workbench plugin
// `components/WorkerRuntimeConfigSurface.tsx`.
//
// One state machine for every runtime:
//   load surface + config → build draft → edit → nested diff → PUT with if-rev
//   → refetch → rev stack → rollback → pendingRestart + explicit restart.
//
// Degrades honestly instead of faking a form:
//   404/405/501 surface or config → "endpoint unsupported" (controller has no
//     adapter for this runtime yet; today only openclaw + hermes register one)
//   409 runtime_unknown → supported runtime list
//   403 → read-only banner (team leader / policy), values still displayed
//
// Only fields declared by the surface are rendered; unknown field types stay
// editable through a JSON control. Saving sends only changed leaves, never the
// whole document and never a masked sensitive value.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, Loader2, RefreshCw, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  fetchMemberConfig,
  fetchRuntimeSurface,
  putMemberConfig,
  rollbackMemberConfig,
} from '@/lib/member-config-api';
import { classifyLoadError, classifyWriteError } from '@/lib/member-config-errors';
import { diffDraft, type CapabilityBucket } from '@/lib/runtime-section-model';
import {
  buildDraft,
  diffNested,
  pushRev,
  type ConfigState,
  type ConfigWriteResult,
  type RuntimeSurface,
} from '@/lib/runtime-surface';
import { applySensitiveObjectText } from '@/lib/runtime-surface-patch';
import { runtimeLabel } from '@/lib/runtime-labels';
import { restartWorkerForConfig, describeRestartError } from '@/lib/worker-config-apply';
import { RuntimeConfigPanel } from './runtime-config/runtime-config-panel';

type Banner = { kind: 'ok' | 'warn' | 'err' | 'info'; text: string };

export interface WorkerRuntimeConfigSurfaceProps {
  workerName: string;
  runtime: string;
  /** Write permission (L1/L2 as resolved by the drawer). Defaults to true;
   * the controller still enforces its own RBAC. */
  canWrite?: boolean;
  /** Capability card bucket (mcp / tools / …); defaults to the full config. */
  bucket?: CapabilityBucket;
  onChanged?: () => void;
}

export function WorkerRuntimeConfigSurface({
  workerName,
  runtime,
  canWrite = true,
  bucket = 'config',
  onChanged,
}: WorkerRuntimeConfigSurfaceProps) {
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [supportedList, setSupportedList] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [surface, setSurface] = useState<RuntimeSurface | null>(null);
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [saving, setSaving] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [revStack, setRevStack] = useState<string[]>([]);

  const busy = saving || rollingBack;
  const noWrite = !canWrite || readOnly;
  const fields = useMemo(
    () => (surface ? surface.faces.flatMap((face) => face.fields) : []),
    [surface],
  );
  const initialDraft = useMemo(
    () => (surface ? buildDraft(surface, config?.values ?? {}) : {}),
    [surface, config],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr('');
    setUnsupported(false);
    setSupportedList('');
    setPendingKeys([]);
    try {
      const [surfaceRes, configRes] = await Promise.allSettled([
        fetchRuntimeSurface(runtime),
        fetchMemberConfig(workerName),
      ]);
      if (surfaceRes.status === 'rejected') {
        const classified = classifyLoadError(surfaceRes.reason);
        if (classified.kind === 'gone') {
          setUnsupported(true);
          return;
        }
        if (classified.kind === 'runtime_unknown') {
          setSupportedList(classified.supported);
          return;
        }
        if (classified.kind === 'forbidden') {
          setReadOnly(true);
          setLoadErr('当前账号无权限读取运行时配置面');
          return;
        }
        setLoadErr(classified.detail);
        return;
      }
      const nextSurface = surfaceRes.value;
      setSurface(nextSurface);
      if (configRes.status === 'rejected') {
        const classified = classifyLoadError(configRes.reason);
        if (classified.kind === 'gone') {
          setUnsupported(true);
          return;
        }
        if (classified.kind === 'runtime_unknown') {
          setSupportedList(classified.supported);
          return;
        }
        if (classified.kind === 'forbidden') {
          setReadOnly(true);
          setLoadErr('当前账号无权限读取该 Worker 配置');
          setDraft(buildDraft(nextSurface, {}));
          return;
        }
        setLoadErr(classified.detail);
        setDraft(buildDraft(nextSurface, {}));
        return;
      }
      setConfig(configRes.value);
      setDraft(buildDraft(nextSurface, configRes.value.values ?? {}));
      // A previous session may have written fields that still wait for a
      // restart — surface the entry point immediately, not only after a save.
      setPendingKeys(configRes.value.pendingRestart ?? []);
      setFieldErrors({});
      setReadOnly(false);
    } finally {
      setLoading(false);
    }
  }, [runtime, workerName]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const onField = useCallback((key: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setBanner(null);
  }, []);

  const afterWrite = useCallback(
    async (result: ConfigWriteResult, previousRev?: string) => {
      let fresh: ConfigState | null = null;
      try {
        fresh = await fetchMemberConfig(workerName);
      } catch {
        /* refetch failed → fall back to the write result */
      }
      if (fresh) {
        setConfig(fresh);
        if (surface) setDraft(buildDraft(surface, fresh.values ?? {}));
      }
      if (previousRev) setRevStack((stack) => pushRev(stack, previousRev));
      const pending = fresh ? fresh.pendingRestart ?? [] : result.pendingRestart ?? [];
      setPendingKeys(pending);
      const notes: string[] = [];
      if (pending.length > 0) notes.push(`已写入，重启后生效：${pending.join('、')}`);
      else if ((fresh ? fresh.applied : result.applied) === 'pending') notes.push('已写入，尚未生效');
      else notes.push('已保存');
      const unsupportedKeys = result.unsupported ?? [];
      if (unsupportedKeys.length > 0) {
        notes.push(
          `运行时不接受：${unsupportedKeys.map((item) => `${item.key}（${item.reason}）`).join('、')}`,
        );
      }
      setBanner({ kind: unsupportedKeys.length > 0 ? 'warn' : 'ok', text: notes.join('　') });
      onChanged?.();
    },
    [surface, workerName, onChanged],
  );

  const onWriteError = useCallback(
    (err: unknown) => {
      const result = classifyWriteError(err);
      switch (result.kind) {
        case 'stale_rev':
          void fetchMemberConfig(workerName)
            .then((next) => setConfig(next))
            .catch(() => undefined);
          setBanner({ kind: 'warn', text: '配置已被他人修改，已重新读取' });
          return;
        case 'unknown_field':
          setBanner({
            kind: 'err',
            text: `存在未知字段：${result.fields.join('、')}（请刷新后重试）`,
          });
          return;
        case 'no_writable_keys':
          setBanner({
            kind: 'err',
            text: `运行时不接受：${result.unsupported
              .map((item) => `${item.key}（${item.reason}）`)
              .join('、')}`,
          });
          return;
        case 'invalid_value':
          if (result.key) {
            setFieldErrors((prev) => ({ ...prev, [result.key]: result.detail || result.key }));
          }
          setBanner({ kind: 'err', text: result.detail || '保存失败' });
          return;
        case 'runtime_unknown':
          setSupportedList(result.supported);
          setBanner(null);
          return;
        case 'forbidden':
          setReadOnly(true);
          setBanner({ kind: 'info', text: '只读：团队 Leader 或策略限制' });
          return;
        case 'gone':
          setUnsupported(true);
          return;
        case 'retryable':
          setBanner({ kind: 'err', text: `保存失败（${result.detail}）` });
          return;
        default:
          setBanner({ kind: 'err', text: result.detail || '保存失败' });
      }
    },
    [workerName],
  );

  const handleSave = useCallback(async () => {
    if (busy || noWrite || !config || !surface) return;
    const values = config.values ?? {};
    const patch = diffNested(draft, values);
    if (Object.keys(patch).length === 0) {
      setBanner({ kind: 'info', text: '无改动' });
      return;
    }
    const parsed = applySensitiveObjectText(fields, draft, patch);
    if (Object.keys(parsed.errors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...parsed.errors }));
      setBanner({ kind: 'err', text: 'JSON 格式不对' });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      await afterWrite(await putMemberConfig(workerName, parsed.patch, config.rev), config.rev);
    } catch (err) {
      onWriteError(err);
    } finally {
      setSaving(false);
    }
  }, [busy, noWrite, config, surface, draft, fields, workerName, afterWrite, onWriteError]);

  const handleRollback = useCallback(async () => {
    if (busy || noWrite || !config || revStack.length === 0) return;
    setRollingBack(true);
    setBanner(null);
    try {
      await afterWrite(await rollbackMemberConfig(workerName, revStack[0]), config.rev);
    } catch (err) {
      onWriteError(err);
    } finally {
      setRollingBack(false);
    }
  }, [busy, noWrite, config, revStack, workerName, afterWrite, onWriteError]);

  const handleRestartNow = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    setBanner(null);
    try {
      await restartWorkerForConfig(workerName);
      setBanner({ kind: 'ok', text: '已发送重启，配置将重新加载' });
      await load();
    } catch (err) {
      setBanner({ kind: 'err', text: describeRestartError(err) });
    } finally {
      setRestarting(false);
    }
  }, [restarting, workerName, load]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        运行时配置加载中…
      </p>
    );
  }

  if (unsupported) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium text-foreground">
              当前 Controller 未提供 {runtimeLabel(runtime)} 的运行时配置面（endpoint unsupported）
            </p>
            <p>
              该运行时未注册 member-config surface 适配器，面板保持只读降级，不会显示伪造字段。
              Controller 增加适配器后本面板自动生效。
            </p>
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void load()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              重试
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (supportedList) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p>当前控制器版本不支持该运行时配置面（控制器支持：{supportedList || '无'}）</p>
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p>读取配置失败：{loadErr}</p>
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  if (!surface) return null;

  const changed = diffDraft(draft, initialDraft);
  const hasChanges = changed.length > 0;

  return (
    <div className="space-y-3">
      {noWrite ? (
        <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          只读：团队 Leader 或策略限制
        </p>
      ) : null}

      {banner ? (
        <p
          className={`flex items-start gap-1.5 rounded-md border p-2 text-xs ${
            banner.kind === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : banner.kind === 'warn'
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                : banner.kind === 'info'
                  ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200'
                  : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {banner.kind === 'ok' ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">{banner.text}</span>
        </p>
      ) : null}

      {pendingKeys.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="min-w-0 flex-1">
            已写入，重启后生效：<span className="font-mono">{pendingKeys.join('、')}</span>
          </span>
          <Button
            size="sm"
            className="h-11 shrink-0 px-4"
            disabled={noWrite || restarting}
            onClick={() => void handleRestartNow()}
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

      <RuntimeConfigPanel
        surface={surface}
        runtime={runtime}
        bucket={bucket}
        draft={draft}
        initialDraft={initialDraft}
        onChange={onField}
        disabled={noWrite || busy}
        errors={fieldErrors}
        values={config?.values}
      />

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          className="h-11 min-w-[96px] px-4"
          disabled={noWrite || busy || !config || !hasChanges}
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
          disabled={noWrite || busy || revStack.length === 0}
          onClick={() => void handleRollback()}
        >
          {rollingBack ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcwIcon />
          )}
          回滚到上次写入
        </Button>
        <Button
          variant="ghost"
          className="h-11 px-3"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />
          刷新
        </Button>
        {config ? (
          <span className="ml-auto text-xs text-muted-foreground">
            rev {config.rev.slice(0, 8)} · {config.applied === 'applied' ? '已生效' : '待生效'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RotateCcwIcon() {
  return <RotateCw className="mr-1 h-4 w-4 -scale-x-100" aria-hidden="true" />;
}

export default WorkerRuntimeConfigSurface;
