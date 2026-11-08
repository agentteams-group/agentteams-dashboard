'use client';

// Manager 容器日志折叠卡（插件 ManagerLogsCard 的 dashboard 版）：
// 默认收起、点击才拨号（不轮询），手动刷新；加载 / 空 / 失败 / 无端点 / 无权
// 各自可读，失败不白屏。

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { agentteamsApi } from '@/lib/agentteams-api';
import {
  classifyManagerLogError,
  formatManagerLogLines,
  type ManagerLogErrorKind,
} from '@/lib/manager-logs';
import { shortErrorMessage } from '@/lib/api-error';

export type ManagerLogState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; lines: string[] }
  | { kind: 'missing' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

/** 拉容器日志（永不 reject；失败即状态）。 */
export async function loadManagerLogs(managerName: string): Promise<ManagerLogState> {
  try {
    const lines = formatManagerLogLines(await agentteamsApi.getManagerLogs(managerName));
    return { kind: 'ok', lines };
  } catch (err) {
    const kind: ManagerLogErrorKind = classifyManagerLogError(err);
    if (kind === 'missing') return { kind: 'missing' };
    if (kind === 'forbidden') return { kind: 'forbidden' };
    return { kind: 'error', message: shortErrorMessage(err) };
  }
}

export function ManagerLogsCard({
  managerName,
  enabled = true,
}: {
  managerName: string;
  /** 日志端点需管理员权限（'manage'）；false = 整卡不显。 */
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<ManagerLogState>({ kind: 'idle' });

  useEffect(() => {
    if (!open || !enabled) return;
    let alive = true;
    setState({ kind: 'loading' });
    void loadManagerLogs(managerName).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [open, enabled, managerName, tick]);

  const reload = useCallback(() => {
    setOpen(true);
    setTick((value) => value + 1);
  }, []);

  if (!enabled) return null;

  const subtitle =
    state.kind === 'loading'
      ? '加载中…'
      : state.kind === 'missing'
        ? '容器日志不可用（Manager 尚未起容器或已删除）'
        : state.kind === 'forbidden'
          ? '无权限查看日志'
          : state.kind === 'error'
            ? '加载失败'
            : state.kind === 'ok'
              ? `最近 ${state.lines.length} 行（tail 300）`
              : '点击加载（tail 300）';

  return (
    <section className="min-w-0 rounded-lg border" aria-label="容器日志">
      <div className="flex min-w-0 items-center gap-1 pr-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 p-2.5 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Terminal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold">容器日志</span>
            <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
          </span>
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
        </button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-11 w-11 shrink-0 p-0"
          aria-label="刷新日志"
          title="刷新"
          onClick={reload}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {open ? (
        <div className="min-w-0 border-t p-2.5">
          {state.kind === 'loading' || state.kind === 'idle' ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              加载中…
            </p>
          ) : state.kind === 'missing' ? (
            <p className="text-xs text-muted-foreground">
              该 Manager 暂无容器日志（未起容器 / 已删除 / Controller 未提供 Docker 代理）
            </p>
          ) : state.kind === 'forbidden' ? (
            <p className="text-xs text-destructive">无权限查看日志：需要 L1 管理员权限</p>
          ) : state.kind === 'error' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-9 text-xs" onClick={reload}>
                加载失败 · 重试
              </Button>
              <span className="text-xs text-muted-foreground">{state.message}</span>
            </div>
          ) : state.lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">（无日志行）</p>
          ) : (
            <pre className="max-h-80 min-w-0 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
              {state.lines.join('\n')}
            </pre>
          )}
        </div>
      ) : null}
    </section>
  );
}
