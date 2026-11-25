'use client';

// Project signal-event panel (controller /signal-events read endpoint, merged
// upstream as PR #1433 — the browser read surface for SIG-* events).
//
// Sibling of ProjectEventsPanel: 事件流 = task state transitions
// (delegate/ack/submit/…), 信号 = the protocol signal feed (SIG-* markers
// written by controller control endpoints and TeamHarness task/loop
// emitters). The 11-field contract has no project_id, so the controller
// attributes events by `ref` / task meta — the frontend always scopes by
// (team, project id).
//
// Data plane: cursor pagination (oldest first). On open we load one page
// (50 events, newest tail shown first) and poll the first page while open;
// `next_cursor` drives the "load more" button for older events. 404
// (Controller predates #1433) renders the "active after upgrade"
// placeholder, not an error.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Radio } from 'lucide-react';
import {
  getProjectSignalEvents,
  type ProjectSignalEvent,
} from '@/lib/agentteams-projects-api';
import { isUnsupportedEndpointError, loadErrorMessage } from '@/lib/api-error';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ok';
      events: ProjectSignalEvent[];
      nextCursor: string;
    }
  | { kind: 'not-deployed' }
  | { kind: 'error'; message: string };

const PAGE_SIZE = 50;
const POLL_MS = 15_000;

/** "2026-09-18T12:34:56Z" → "09-18 12:34:56" (local time). */
function fmtEventTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Merge pages by event_id, newest last, then reverse for display. */
function mergeEvents(current: ProjectSignalEvent[], incoming: ProjectSignalEvent[]): ProjectSignalEvent[] {
  const seen = new Set(current.map((ev) => ev.event_id));
  const merged = [...current];
  for (const ev of incoming) {
    if (seen.has(ev.event_id)) continue;
    seen.add(ev.event_id);
    merged.push(ev);
  }
  return merged.sort((a, b) =>
    a.occurred_at === b.occurred_at
      ? a.event_id.localeCompare(b.event_id)
      : a.occurred_at.localeCompare(b.occurred_at),
  );
}

function PayloadSummary({ payload }: { payload?: Record<string, unknown> }) {
  if (!payload) return null;
  const entries = Object.entries(payload).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;
  return (
    <span
      className="max-w-[320px] truncate text-muted-foreground"
      title={JSON.stringify(payload)}
    >
      {entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')}
    </span>
  );
}

function EventRow({ event }: { event: ProjectSignalEvent }) {
  const loopText =
    typeof event.iteration_index === 'number' ? `#${event.iteration_index}` : event.loop_id ?? '';
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="tabular-nums text-muted-foreground">
        {fmtEventTime(event.occurred_at)}
      </span>
      <span className="font-medium text-foreground">{event.event_type}</span>
      {event.is_signal ? (
        <span className="rounded bg-violet-500/15 px-1 text-xs text-violet-700 dark:text-violet-300">
          信号
        </span>
      ) : null}
      {event.task_id ? (
        <span className="font-mono text-muted-foreground">{event.task_id}</span>
      ) : null}
      {loopText ? <span className="text-muted-foreground">loop {loopText}</span> : null}
      {event.source_event?.origin ? (
        <span className="text-muted-foreground">{event.source_event.origin}</span>
      ) : null}
      <PayloadSummary payload={event.payload} />
    </div>
  );
}

export function ProjectSignalEventsPanel({
  projectId,
  teamId,
}: {
  projectId: string;
  teamId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const busyRef = useRef(false);

  const toggle = () => {
    if (!open) setState({ kind: 'loading' });
    setOpen((v) => !v);
  };

  // First load on open + poll the latest page while open. The retained
  // events are merged by event_id so a poll never duplicates entries.
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const run = () => {
      if (busyRef.current) return;
      busyRef.current = true;
      getProjectSignalEvents(projectId, teamId, { limit: PAGE_SIZE })
        .then((resp) => {
          if (stopped) return;
          setState((prev) => {
            const current = prev.kind === 'ok' ? prev.events : [];
            return {
              kind: 'ok',
              events: mergeEvents(current, resp.events),
              // Keep the older anchor when a "load more" page was fetched:
              // a fresh first page always carries the newest tail cursor.
              nextCursor: prev.kind === 'ok' && prev.nextCursor ? prev.nextCursor : resp.next_cursor ?? '',
            };
          });
        })
        .catch((e: unknown) => {
          if (stopped) return;
          if (isUnsupportedEndpointError(e)) {
            setState({ kind: 'not-deployed' });
          } else {
            setState({ kind: 'error', message: loadErrorMessage(e, '信号加载失败') });
          }
        })
        .finally(() => {
          busyRef.current = false;
        });
    };
    run();
    const timer = window.setInterval(run, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, projectId, teamId]);

  const loadMore = () => {
    if (state.kind !== 'ok' || !state.nextCursor || busyRef.current) return;
    busyRef.current = true;
    getProjectSignalEvents(projectId, teamId, {
      limit: PAGE_SIZE,
      cursor: state.nextCursor,
    })
      .then((resp) => {
        setState((prev) => {
          if (prev.kind !== 'ok') return prev;
          return {
            kind: 'ok',
            events: mergeEvents(prev.events, resp.events),
            nextCursor: resp.next_cursor ?? '',
          };
        });
      })
      .catch((e: unknown) => {
        setState((prev) =>
          prev.kind === 'ok'
            ? prev
            : { kind: 'error', message: loadErrorMessage(e, '信号加载失败') },
        );
      })
      .finally(() => {
        busyRef.current = false;
      });
  };

  const shown = state.kind === 'ok' ? [...state.events].reverse() : [];
  const hasMore = state.kind === 'ok' && Boolean(state.nextCursor);

  let listBody: ReactNode = <span className="text-muted-foreground">加载中…</span>;
  if (state.kind === 'error') {
    listBody = <span className="text-muted-foreground">{state.message}</span>;
  } else if (state.kind === 'not-deployed') {
    listBody = (
      <span className="text-muted-foreground">
        信号端点未部署——Controller 升级到含 signal-event 读端（上游 #1433）的版本后这里会聚合
      </span>
    );
  } else if (state.kind === 'ok' && shown.length === 0) {
    listBody = (
      <span className="text-muted-foreground">
        暂无信号——出现暂停/恢复/升级/超时等协议事件后这里会聚合
      </span>
    );
  } else if (state.kind === 'ok') {
    listBody = (
      <>
        {shown.map((ev) => (
          <EventRow key={ev.event_id} event={ev} />
        ))}
        {hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            className="mt-1 text-xs text-sky-600 hover:underline dark:text-sky-400"
          >
            加载更早的信号
          </button>
        ) : null}
      </>
    );
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
        <Radio className="h-3.5 w-3.5" />
        <span>信号</span>
        {state.kind === 'ok' && shown.length > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs">{shown.length}</span>
        ) : null}
      </button>
      {open ? (
        <div
          className="mt-2 space-y-1.5 overflow-y-auto pl-4 text-xs"
          style={{ maxHeight: 320 }}
        >
          {listBody}
        </div>
      ) : null}
    </div>
  );
}
