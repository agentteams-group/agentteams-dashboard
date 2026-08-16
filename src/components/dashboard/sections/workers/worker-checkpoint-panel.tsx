'use client';

// Worker execution checkpoint panel (controller checkpoint read endpoints).
// Lazy-loads on first expansion; renders a "需 QwenPaw 2.1" placeholder
// for pre-2.1 workers (Controller 502 degradation, remembered per session).

import { useEffect, useState, type ReactNode } from 'react';
import { Bookmark, ChevronDown, ChevronRight } from 'lucide-react';
import {
  CheckpointUnavailableError,
  getWorkerCheckpointGraph,
  getWorkerCheckpointStatus,
  type CheckpointGraphResponse,
  type CheckpointStatusResponse,
} from '@/lib/agentteams-worker-checkpoints';
import { loadErrorMessage } from '@/lib/api-error';

// Pre-2.1 workers stay unavailable for the session: the Controller will not
// gain the checkpoint route on its own, so caching the 502 verdict avoids
// re-hitting it (and the loading flicker on slow networks) on every expand.
const unavailableWorkers = new Set<string>();

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; status: CheckpointStatusResponse; graph: CheckpointGraphResponse }
  // Half-degradation: status answered but the graph did not — the auto
  // flag is still useful, so it stays visible while the list degrades.
  | { kind: 'partial'; status: CheckpointStatusResponse; graphError: string }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

const KIND_STYLE: Record<string, string> = {
  auto: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  snap: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'pre-restore': 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
};

// `kind` is an open vocabulary (the Controller may add kinds), so an
// unknown kind intentionally falls back to the neutral style below instead
// of failing — an exhaustive Record would reject future kinds at compile
// time and hide the new badge behind a type error.

function fmtTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString();
}

function renderNode(n: CheckpointNodeLike): ReactNode {
  return (
    <div key={n.ref} className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 ${KIND_STYLE[n.kind] || 'bg-muted'}`}>
          {n.kind}
        </span>
        <span className="text-muted-foreground">{fmtTime(n.timestamp_ms)}</span>
        {n.is_head ? <span className="text-orange-500">●</span> : null}
      </div>
      {n.query ? (
        <div className="truncate text-muted-foreground" title={n.query}>
          {n.query}
        </div>
      ) : n.subject ? (
        <div className="text-muted-foreground">{n.subject}</div>
      ) : null}
    </div>
  );
}

type CheckpointNodeLike = CheckpointGraphResponse['nodes'][number];

export function WorkerCheckpointPanel({ workerName }: { workerName: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  const toggle = () => {
    if (!open) {
      // Lazy load: mark loading synchronously from the event handler
      // (not inside the effect), then let the effect run the fetch. A
      // cached "unavailable" verdict (pre-2.1 worker) skips the fetch
      // entirely — set from the handler to avoid a sync setState in the
      // effect.
      if (unavailableWorkers.has(workerName)) {
        setState({ kind: 'unavailable' });
      } else {
        setState({ kind: 'loading' });
      }
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (unavailableWorkers.has(workerName)) return; // toggle set 'unavailable'
    const controller = new AbortController();
    (async () => {
      // allSettled so a status-200 + graph-5xx half-degradation still shows
      // the auto flag instead of failing the whole panel.
      const [statusSettled, graphSettled] = await Promise.allSettled([
        getWorkerCheckpointStatus(workerName, controller.signal),
        getWorkerCheckpointGraph(workerName, 100, controller.signal),
      ]);
      // Aborted (dialog closed / unmounted) — drop both results.
      if (
        statusSettled.status === 'rejected' &&
        statusSettled.reason instanceof DOMException &&
        statusSettled.reason.name === 'AbortError'
      ) {
        return;
      }
      // Whole worker unavailable (QwenPaw < 2.1) — remember for the session.
      if (
        graphSettled.status === 'rejected' &&
        graphSettled.reason instanceof CheckpointUnavailableError
      ) {
        unavailableWorkers.add(workerName);
        setState({ kind: 'unavailable' });
        return;
      }
      if (statusSettled.status === 'rejected') {
        setState({
          kind: 'error',
          message: loadErrorMessage(statusSettled.reason, '检查点加载失败'),
        });
        return;
      }
      const status = statusSettled.value;
      if (graphSettled.status === 'rejected') {
        setState({
          kind: 'partial',
          status,
          graphError: loadErrorMessage(graphSettled.reason, '打点列表加载失败'),
        });
      } else {
        setState({ kind: 'ok', status, graph: graphSettled.value });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [open, workerName]);

  // Narrow once: status/graph shared by ok and partial, list only by ok.
  const status: CheckpointStatusResponse | null =
    state.kind === 'ok' || state.kind === 'partial' ? state.status : null;
  const graph: CheckpointGraphResponse | null =
    state.kind === 'ok' ? state.graph : null;
  const graphError: string | null =
    state.kind === 'partial' ? state.graphError : null;

  let body: ReactNode = <span className="text-muted-foreground">加载中…</span>;
  if (state.kind === 'unavailable') {
    body = (
      <span className="text-muted-foreground">
        该 Worker 需 QwenPaw 2.1 才支持检查点
      </span>
    );
  } else if (state.kind === 'error') {
    body = <span className="text-muted-foreground">{state.message}</span>;
  } else if (status) {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={
              status.auto_enabled
                ? 'rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'rounded bg-muted px-1.5 py-0.5 text-muted-foreground'
            }
          >
            {status.auto_enabled ? '自动打点 开' : '自动打点 关'}
          </span>
          {graph
            ? graph.summary.total > 0
              ? [
                  ['自动', graph.summary.auto, 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'],
                  ['快照', graph.summary.snapshots, 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'],
                  ['安全', graph.summary.safety, 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'],
                ].map(([label, count, cls]) => (
                    <span key={String(label)} className={`rounded px-1.5 py-0.5 ${cls}`}>
                      {label} {count}
                    </span>
                  ))
              : (
                  <span className="text-muted-foreground">暂无检查点</span>
                )
            : null}
          {graphError ? (
            <span className="text-muted-foreground">{graphError}</span>
          ) : null}
        </div>
        {graph ? graph.nodes.slice(0, 5).map(renderNode) : null}
      </>
    );
  }

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Bookmark className="h-3.5 w-3.5" />
        <span>检查点</span>
        {graph && graph.summary.total > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs">
            {graph.summary.total}
          </span>
        ) : null}
      </button>
      {open ? <div className="mt-2 space-y-1.5 pl-4 text-xs">{body}</div> : null}
    </div>
  );
}
