'use client';

// Project intervention timeline panel (controller history read endpoint).
// Lists the pre-intervention meta snapshots newest-first; clicking one
// fetches the raw snapshot and shows the key audit fields.

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import {
  getProjectHistory,
  getProjectHistorySnapshot,
  type ProjectHistorySnapshotDetail,
} from '@/lib/agentteams-projects-api';
import { loadErrorMessage } from '@/lib/api-error';
import { formatNanoTimestamp } from '@/lib/format-timestamp';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; snapshots: { timestamp: string }[] }
  | { kind: 'error'; message: string };

export function ProjectTimelinePanel({
  projectId,
  teamId,
}: {
  projectId: string;
  teamId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [detail, setDetail] = useState<ProjectHistorySnapshotDetail | null>(null);

  const toggle = () => {
    if (!open) {
      // Lazy load: mark loading synchronously from the event handler
      // (not inside the effect), then let the effect run the fetch.
      setState({ kind: 'loading' });
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    getProjectHistory(projectId, teamId, controller.signal)
      .then((resp) => {
        setState({ kind: 'ok', snapshots: resp.snapshots });
      })
      .catch((e: unknown) => {
        // Aborted (panel closed / component unmounted) — nothing to show.
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({
          kind: 'error',
          // 404 = Controller 尚无该端点（未升级）→ 与检查点面板同款占位文案
          message: loadErrorMessage(e, '时间线加载失败'),
        });
      });
    return () => {
      controller.abort();
    };
  }, [open, projectId, teamId]);

  const openDetail = (ts: string) => {
    getProjectHistorySnapshot(projectId, ts, teamId)
      .then((raw) => setDetail(raw))
      .catch(() => setDetail(null));
  };

  const rows: [string, unknown][] = detail
    ? [
        ['状态', detail.status],
        ['标题', detail.title],
        ['操作人', detail.updated_by],
        ['操作时间', detail.updated_at],
        ['暂停原因', detail.pause_reason],
      ]
    : [];

  // Narrow once: everything below only deals with the resolved list.
  let listBody: ReactNode = (
    <span className="text-muted-foreground">加载中…</span>
  );
  if (state.kind === 'error') {
    listBody = <span className="text-muted-foreground">{state.message}</span>;
  } else if (state.kind === 'ok' && state.snapshots.length === 0) {
    listBody = <span className="text-muted-foreground">暂无干预记录</span>;
  } else if (state.kind === 'ok') {
    listBody = state.snapshots.map((s) => (
      <button
        key={s.timestamp}
        type="button"
        onClick={() => openDetail(s.timestamp)}
        className="flex w-full items-center gap-2 text-left text-muted-foreground hover:text-foreground"
      >
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/40" />
        <span>{formatNanoTimestamp(s.timestamp)}</span>
      </button>
    ));
  }

  return (
    <div className="mt-3 rounded-md border p-3">
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
        <ScrollText className="h-3.5 w-3.5" />
        <span>时间线</span>
        {state.kind === 'ok' && state.snapshots.length > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs">
            {state.snapshots.length}
          </span>
        ) : null}
      </button>
      {open ? <div className="mt-2 space-y-1 pl-4 text-xs">{listBody}</div> : null}
      {detail ? (
        <div className="mt-2 space-y-1 rounded bg-muted/50 p-2 text-xs">
          {rows.map(([label, value]) =>
            value === undefined || value === null || value === '' ? null : (
              <div key={label}>
                <span className="text-muted-foreground">{label}：</span>
                <span>{String(value)}</span>
              </div>
            ),
          )}
          {Array.isArray(detail.tasks) ? (
            <div>
              <span className="text-muted-foreground">任务数：</span>
              <span>{detail.tasks.length}</span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="text-muted-foreground underline"
          >
            收起
          </button>
        </div>
      ) : null}
    </div>
  );
}
