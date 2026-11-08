'use client';

// Worker runtime-config apply state + explicit restart action.
//
// Non-QwenPaw runtimes persist their native config through the controller's
// member-config surface. A write can land on disk while the running process
// still uses the old values: the controller reports that as `applied=pending`
// and/or a `pendingRestart` key list (it never restarts the worker itself).
//
// This panel surfaces that state and offers the one explicit user action that
// makes the saved values take effect — POST /workers/{name}/restart
// (upstream #1473). There is deliberately no auto-restart and no polling that
// restarts: the click is the consent.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ApiError, shortErrorMessage } from '@/lib/api-error';
import {
  fetchMemberConfig,
  pendingRestartKeys,
  restartRequired,
  restartWorkerForConfig,
  describeRestartError,
  type MemberConfigState,
} from '@/lib/worker-config-apply';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; config: MemberConfigState }
  | { kind: 'unavailable'; reason: 'missing' | 'runtime' | 'mode' }
  | { kind: 'error'; message: string };

type ActionMessage = { kind: 'ok' | 'warn' | 'err'; text: string };

const APPLIED_LABEL: Record<string, string> = {
  applied: '已生效',
  pending: '待重启生效',
  unapplied: '未生效',
  'applied-but-inactive': '已写入但未激活',
};

async function readConfig(workerName: string): Promise<LoadState> {
  try {
    return { kind: 'ready', config: await fetchMemberConfig(workerName) };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) return { kind: 'unavailable', reason: 'missing' };
      if (err.status === 409) return { kind: 'unavailable', reason: 'runtime' };
      if (err.status === 503) return { kind: 'unavailable', reason: 'mode' };
    }
    return { kind: 'error', message: shortErrorMessage(err) };
  }
}

const UNAVAILABLE_COPY: Record<'missing' | 'runtime' | 'mode', string> = {
  missing: '该运行时未提供配置生效状态——Controller 升级后自动生效',
  runtime: '该运行时暂不支持配置生效检测（支持 openclaw / hermes）',
  mode: '当前部署模式不支持运行时配置管理（需嵌入式模式）',
};

export function WorkerRestartEffectivePanel({ workerName }: { workerName: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Defer past the effect's synchronous phase: readConfig always settles
    // through a state update (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      void readConfig(workerName).then((next) => {
        if (!cancelled) setState(next);
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workerName]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setMessage(null);
    setState(await readConfig(workerName));
    setRefreshing(false);
  }, [workerName]);

  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    setMessage(null);
    try {
      const result = await restartWorkerForConfig(workerName);
      toast.success('已触发重启，运行时配置将重新加载');
      const next = await readConfig(workerName);
      setState(next);
      if (next.kind === 'ready' && restartRequired(next.config)) {
        setMessage({ kind: 'warn', text: '重启已触发，但仍有未生效配置——请检查 Worker 日志或稍后刷新' });
      } else if (next.kind === 'error' || next.kind === 'unavailable') {
        setMessage({ kind: 'warn', text: '重启已触发，但状态刷新失败，请稍后手动刷新' });
      } else {
        setMessage({
          kind: 'ok',
          text: `重启完成（phase=${result.phase || 'unknown'}），运行时配置已生效`,
        });
      }
    } catch (err) {
      const text = describeRestartError(err);
      toast.error(text);
      setMessage({ kind: 'err', text });
    } finally {
      setRestarting(false);
    }
  }, [restarting, workerName]);

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        运行时配置生效状态加载中…
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
        {UNAVAILABLE_COPY[state.reason]}
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">配置生效状态加载失败：{state.message}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          重试
        </Button>
      </div>
    );
  }

  const { config } = state;
  const needsRestart = restartRequired(config);
  const keys = pendingRestartKeys(config);
  const inactive = config.inactive ?? [];

  return (
    <div className="space-y-2 rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {needsRestart ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
          )}
          运行时配置生效状态
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{config.runtime}</span>
          <span>·</span>
          <span
            className={
              needsRestart ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
            }
          >
            {APPLIED_LABEL[config.applied] ?? config.applied}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => void refresh()}
            disabled={refreshing || restarting}
            aria-label="刷新配置生效状态"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </span>
      </div>

      {needsRestart ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">已保存，待重启生效</p>
          {keys.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {keys.map((key) => (
                <span key={key} className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono">
                  {key}
                </span>
              ))}
            </p>
          )}
          <p className="mt-1 opacity-80">重启是显式操作，不会自动执行。</p>
        </div>
      ) : inactive.length > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          配置已写入，但以下通道未激活：<span className="font-mono">{inactive.join(', ')}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">运行时配置已生效，无需重启。</p>
      )}

      {needsRestart && (
        <div className="flex flex-wrap items-center gap-2">
          {/* 44px target: this restart is the panel's primary action. */}
          <Button
            className="h-11 px-4"
            onClick={() => void handleRestart()}
            disabled={restarting}
          >
            {restarting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCw className="mr-1 h-4 w-4" aria-hidden="true" />
            )}
            {restarting ? '重启中…' : '重启生效'}
          </Button>
          <span className="text-xs text-muted-foreground">重启后 Worker 会重新读取已保存的配置</span>
        </div>
      )}

      {message && (
        <p
          className={`text-xs ${
            message.kind === 'ok'
              ? 'text-emerald-600 dark:text-emerald-400'
              : message.kind === 'warn'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-600 dark:text-red-400'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
