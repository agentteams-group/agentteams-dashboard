'use client';

// Team attention inbox panel (controller /teams/{name}/attention read
// endpoint, merged upstream as PR #1503).
//
// Sibling of ProjectAttentionPanel, one level up: every project of the team,
// then every graph task of every project. The worker records in-flight human
// requests (approval / decision / escalation) into each task meta's
// `attention` list; the human answer still goes to the task's Matrix room, so
// this panel is read-only.
//
// Data plane: one GET on open plus a 15 s poll; 404 (Controller predates
// #1503) renders the "active after upgrade" placeholder, not an error. The
// row carries `overdue`, resolved by the controller's clock, so no local
// deadline comparison is needed here.

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Inbox, AlertTriangle } from 'lucide-react';
import {
  agentteamsApi,
  type TeamAttentionItem,
  type TeamAttentionResponse,
} from '@/lib/agentteams-api';
import { isUnsupportedEndpointError, loadErrorMessage } from '@/lib/api-error';
import { openChatRoom } from '@/lib/open-chat-room';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: TeamAttentionResponse }
  | { kind: 'not-deployed' }
  | { kind: 'error'; message: string };

const POLL_MS = 15_000;

/** "2026-11-04T08:00:00Z" → "12分钟前" (local clock). */
function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60000) return `${Math.max(1, Math.floor(diff / 1000))}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

/**
 * Deep-link one row into the task board's project view. Reuses the established
 * pending-project channel (setPendingProjectKey + tasks section), which the
 * chat workflow card and loop cards already use.
 */
function openProject(projectId: string, teamId: string) {
  useHitlInboxStore
    .getState()
    .setPendingProjectKey(teamId ? { id: projectId, team: teamId } : { id: projectId });
  useSectionStore.getState().setActiveSection('tasks');
}

function AttentionRow({ item }: { item: TeamAttentionItem }) {
  const pending = !item.resolved;
  const body = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="truncate font-medium">
          {item.kind || '提问'}
          {item.options?.length ? ` · ${item.options.length} 个选项` : ''}
          {item.freeform ? ' · 自由回答' : ''}
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatRelativeTime(Date.parse(item.requestedAt))}
        </span>
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {item.question || '（无问题文本）'}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="truncate font-mono">{item.projectId || '-'}</span>
        <span className="truncate font-mono">· {item.taskId}</span>
        {item.overdue && pending && (
          <span className="text-red-600 dark:text-red-400">· 已超时</span>
        )}
        {item.resolved && <span className="text-emerald-600 dark:text-emerald-400">· 已处理</span>}
        {item.notified === null && pending && (
          <span className="text-amber-600 dark:text-amber-400">· 未通知</span>
        )}
        {item.notified && item.notified.gaps.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            · 通知缺口 {item.notified.gaps.length}
          </span>
        )}
      </div>
    </>
  );

  const tone = item.overdue && pending
    ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
    : pending
      ? 'border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10'
      : 'border-border/60 bg-background/40 hover:bg-accent/60';
  const className = `w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${tone}`;

  // Answering happens in the task's Matrix room, so a row bound to a room
  // deep-links there; the rest still open the project view.
  if (item.roomId) {
    return (
      <button type="button" onClick={() => openChatRoom(item.roomId)} className={className}>
        {body}
      </button>
    );
  }
  if (item.projectId) {
    return (
      <button
        type="button"
        onClick={() => openProject(item.projectId, item.teamId)}
        className={className}
      >
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

export function TeamAttentionPanel({
  teamName,
  defaultOpen = false,
}: {
  teamName: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
      agentteamsApi
        .getTeamAttention(teamName)
        .then((data) => {
          if (stopped) return;
          setState({ kind: 'ok', data });
        })
        .catch((e: unknown) => {
          if (stopped) return;
          if (isUnsupportedEndpointError(e)) {
            setState({ kind: 'not-deployed' });
          } else {
            setState({ kind: 'error', message: loadErrorMessage(e, '团队待决策加载失败') });
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
  }, [open, teamName]);

  const items = state.kind === 'ok' ? state.data.items : [];
  const unresolved = items.filter((it) => !it.resolved);
  const overdue = items.filter((it) => it.overdue && !it.resolved);
  const count = unresolved.length;
  const truncated = state.kind === 'ok' && state.data.truncated;

  let listBody: ReactNode = <span className="text-muted-foreground">加载中…</span>;
  if (state.kind === 'error') {
    listBody = <span className="text-muted-foreground">{state.message}</span>;
  } else if (state.kind === 'not-deployed') {
    listBody = (
      <span className="text-muted-foreground">
        团队待决策端点未部署——Controller 升级到含团队 attention 收件箱（上游 #1503）的版本后这里会聚合
      </span>
    );
  } else if (state.kind === 'ok' && items.length === 0) {
    listBody = (
      <span className="text-muted-foreground">
        暂无待决策——团队成员发起审批/决策/升级请求后这里会聚合
      </span>
    );
  } else if (state.kind === 'ok') {
    listBody = (
      <>
        {items.map((item, i) => (
          <AttentionRow
            key={`${item.projectId}-${item.taskId}-${item.kind}-${item.eventId ?? i}`}
            item={item}
          />
        ))}
        {truncated && (
          <span className="block pt-1 text-xs text-muted-foreground">
            还有更多匹配项——收件箱按上限截断，缩小范围请到项目视图查看
          </span>
        )}
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
        <Inbox className="h-3.5 w-3.5" />
        <span>团队待决策</span>
        {count > 0 ? (
          <span className="rounded-full bg-sky-500/15 px-1.5 text-xs text-sky-700 dark:text-sky-300">
            {count}
          </span>
        ) : null}
        {overdue.length > 0 ? (
          <span className="flex items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle className="h-3 w-3" />
            超时 {overdue.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 overflow-y-auto pl-4" style={{ maxHeight: 320 }}>
          {listBody}
        </div>
      ) : null}
    </div>
  );
}
