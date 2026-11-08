'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface CheckpointNode {
  ref: string;
  kind: string;
  name: string;
  subject: string;
  timestamp_ms: number;
  is_head: boolean;
}

interface CheckpointGraph {
  nodes: CheckpointNode[];
  summary: { total: number; auto: number; snapshots: number; safety: number; heads: number };
  truncated?: boolean;
}

interface CheckpointStatus {
  auto_enabled: boolean;
  has_checkpoints: boolean;
  workspace_dir: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; status: CheckpointStatus; graph: CheckpointGraph };

function fmtTime(ms: number): string {
  if (!ms) return '-';
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '-';
  }
}

/** 检查点只读卡：GET /workers/{name}/checkpoints/{status,graph}。 */
export function WorkerCheckpointsCard({ workerName }: { workerName: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const base = `/api/agentteams/workers/${encodeURIComponent(workerName)}/checkpoints`;
    try {
      const [statusRes, graphRes] = await Promise.all([
        fetch(`${base}/status`, { cache: 'no-store' }),
        fetch(`${base}/graph?limit=20`, { cache: 'no-store' }),
      ]);
      if ([statusRes.status, graphRes.status].some((s) => s === 403 || s === 404 || s === 405)) {
        setState({ kind: 'unsupported' });
        return;
      }
      if ([statusRes.status, graphRes.status].some((s) => s === 502 || s === 503)) {
        setState({ kind: 'unavailable' });
        return;
      }
      if (!statusRes.ok || !graphRes.ok) {
        const body = (await statusRes.json().catch(() => ({}))) as { error?: string };
        setState({ kind: 'error', message: body.error ?? `HTTP ${statusRes.status}` });
        return;
      }
      const status = (await statusRes.json()) as CheckpointStatus;
      const graph = (await graphRes.json()) as CheckpointGraph;
      setState({
        kind: 'ready',
        status,
        graph: {
          nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
          summary: graph.summary ?? { total: 0, auto: 0, snapshots: 0, safety: 0, heads: 0 },
          truncated: graph.truncated,
        },
      });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : '网络错误' });
    }
  }, [workerName]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 p-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        检查点加载中…
      </div>
    );
  }

  if (state.kind === 'unsupported') {
    return (
      <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
        该 Controller 不支持检查点读取（需 QwenPaw ≥ 2.1）。
      </p>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
        检查点暂不可用（Worker 未运行或运行时不支持）。
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">检查点读取失败：{state.message}</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          重试
        </Button>
      </div>
    );
  }

  const { status, graph } = state;
  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
        暂无检查点{status.auto_enabled ? '（自动快照已开启，执行一轮后出现）' : '（自动快照未开启）'}。
      </p>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">共 {graph.summary.total}</Badge>
        <Badge variant="outline" className="text-xs">自动 {graph.summary.auto}</Badge>
        <Badge variant="outline" className="text-xs">快照 {graph.summary.snapshots}</Badge>
        <span className="text-muted-foreground">
          {status.auto_enabled ? '自动快照已开启' : '自动快照未开启'}
          {graph.truncated ? ' · 已截断' : ''}
        </span>
      </div>
      <ul className="space-y-1">
        {graph.nodes.slice(0, 8).map((node) => (
          <li key={node.ref || `${node.name}-${node.timestamp_ms}`} className="flex items-baseline gap-2">
            <span className="shrink-0 font-mono text-muted-foreground">{fmtTime(node.timestamp_ms)}</span>
            <span className="shrink-0">{node.kind || 'auto'}</span>
            {node.is_head && <Badge variant="secondary" className="text-xs">HEAD</Badge>}
            <span className="min-w-0 truncate" title={node.subject}>{node.subject || node.name || node.ref}</span>
          </li>
        ))}
      </ul>
      {status.workspace_dir && (
        <p className="truncate font-mono text-muted-foreground" title={status.workspace_dir}>
          {status.workspace_dir}
        </p>
      )}
    </div>
  );
}
