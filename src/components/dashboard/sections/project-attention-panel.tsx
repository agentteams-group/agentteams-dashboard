'use client';

// Project attention panel (controller /attention read endpoint, merged
// upstream as PR #1434 — workbench decision modal).
//
// The worker records in-flight attention requests (approval / decision /
// escalation) into each task meta's `attention` list; the human answer still
// goes to the task's Matrix room. This panel is the read-only aggregate so
// the operator can see every unanswered question across the project's graph
// tasks without opening each room.
//
// Data plane: one GET on open plus a 15 s poll; 404 (Controller predates
// #1434) renders the "active after upgrade" placeholder, not an error.
// `expires_at` is the server-resolved S0 deadline (`timeoutAt`), so overdue
// highlighting uses the controller's clock rather than a local window.

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { getProjectAttention, type ProjectAttentionItem } from '@/lib/agentteams-projects-api';
import { isUnsupportedEndpointError, loadErrorMessage } from '@/lib/api-error';
import { openChatRoom } from '@/lib/open-chat-room';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; items: ProjectAttentionItem[] }
  | { kind: 'not-deployed' }
  | { kind: 'error'; message: string };

const POLL_MS = 15_000;

/** "2026-11-04T08:00:00Z" → "12分钟前" (local clock). */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (!Number.isFinite(timestamp)) return '';
  if (diff < 60000) return `${Math.max(1, Math.floor(diff / 1000))}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

function isOverdue(item: ProjectAttentionItem, now: number): boolean {
  if (!item.expires_at) return false;
  const at = Date.parse(item.expires_at);
  return Number.isFinite(at) && at < now;
}

function AttentionRow({ item, now }: { item: ProjectAttentionItem; now: number }) {
  const overdue = isOverdue(item, now);
  const pending = !item.resolved;
  const body = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="truncate font-medium">
          {item.kind || '提问'}
          {item.attempt > 0 ? ` · 第 ${item.attempt} 次` : ''}
          {item.options?.length ? ` · ${item.options.length} 个选项` : ''}
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatRelativeTime(Date.parse(item.requested_at) || Date.now())}
        </span>
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {item.question || '（无问题文本）'}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="truncate font-mono">{item.task_id}</span>
        {item.task_title && <span className="truncate">· {item.task_title}</span>}
        {item.suggested && <span className="truncate">· 建议 {item.suggested}</span>}
        {overdue && pending && (
          <span className="text-red-600 dark:text-red-400">· 已超时</span>
        )}
        {item.resolved && <span className="text-emerald-600 dark:text-emerald-400">· 已处理</span>}
      </div>
    </>
  );

  const tone = overdue && pending
    ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
    : pending
      ? 'border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10'
      : 'border-border/60 bg-background/40 hover:bg-accent/60';
  const className = `w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${tone}`;

  // Only items bound to a task room can deep-link; the rest are read-only
  // context (the controller never owns the answer path).
  if (item.room_id) {
    return (
      <button type="button" onClick={() => openChatRoom(item.room_id)} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

export function ProjectAttentionPanel({
  projectId,
  teamId,
  now,
}: {
  projectId: string;
  teamId?: string;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  const toggle = () => {
    if (!open) setState({ kind: 'loading' });
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let inflight = false;
    const run = () => {
      if (inflight) return;
      inflight = true;
      getProjectAttention(projectId, teamId)
        .then((resp) => {
          if (stopped) return;
          setState({ kind: 'ok', items: resp.items });
        })
        .catch((e: unknown) => {
          if (stopped) return;
          if (isUnsupportedEndpointError(e)) {
            setState({ kind: 'not-deployed' });
          } else {
            setState({ kind: 'error', message: loadErrorMessage(e, '待决策加载失败') });
          }
        })
        .finally(() => {
          inflight = false;
        });
    };
    run();
    const timer = window.setInterval(run, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, projectId, teamId]);

  const items = state.kind === 'ok' ? state.items : [];
  const unresolved = items.filter((it) => !it.resolved);
  const overdue = unresolved.filter((it) => isOverdue(it, now));
  const count = unresolved.length;

  let listBody: ReactNode = <span className="text-muted-foreground">加载中…</span>;
  if (state.kind === 'error') {
    listBody = <span className="text-muted-foreground">{state.message}</span>;
  } else if (state.kind === 'not-deployed') {
    listBody = (
      <span className="text-muted-foreground">
        待决策端点未部署——Controller 升级到含项目 attention 读端（上游 #1434）的版本后这里会聚合
      </span>
    );
  } else if (state.kind === 'ok' && items.length === 0) {
    listBody = (
      <span className="text-muted-foreground">
        暂无待决策——Agent 发起审批/决策/升级请求后这里会聚合
      </span>
    );
  } else if (state.kind === 'ok') {
    listBody = (
      <>
        {items.map((item, i) => (
          <AttentionRow
            key={`${item.task_id}-${item.kind}-${item.attempt}-${item.event_id ?? i}`}
            item={item}
            now={now}
          />
        ))}
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
        <HelpCircle className="h-3.5 w-3.5" />
        <span>待决策</span>
        {count > 0 ? (
          <span className="rounded-full bg-sky-500/15 px-1.5 text-xs text-sky-700 dark:text-sky-300">
            {count}
          </span>
        ) : null}
        {overdue.length > 0 ? (
          <span className="rounded-full bg-red-500/15 px-1.5 text-xs text-red-700 dark:text-red-300">
            超时 {overdue.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="mt-2 space-y-1.5 overflow-y-auto pl-4"
          style={{ maxHeight: 320 }}
        >
          {listBody}
        </div>
      ) : null}
    </div>
  );
}
