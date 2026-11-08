'use client';

// Project "子会话" card — spawn subagent tree + lazy message stream.
//
// Data plane: one GET `/api/agentteams/projects/{id}/spawns` on mount (the
// panel is only mounted from the project/workflow detail, so there is no
// background cost elsewhere), and one GET per node's 「消息」 click (lazy —
// never batch-fetched with the tree).
//
// Honest degradation:
// - 404 / 405 (Controller predates the spawn routes) → the whole card is
//   hidden, never a blank shell or an error box;
// - other failures → inline 加载失败 · 重试, staying inside the card;
// - message stream: 404 = 暂无消息, 403 = 无权限查看, rest = retryable,
//   `has_more` = 仅显示最近 N 条.

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Loader2, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  getProjectSpawns,
  getSpawnMessages,
  type ProjectWorkerSpawns,
  type SpawnMessage,
  type SpawnMessagesResponse,
  type SpawnNode,
  type SpawnStatus,
} from '@/lib/agentteams-projects-api';
import { shortErrorMessage } from '@/lib/api-error';
import {
  buildSpawnForest,
  classifySpawnError,
  countSpawnNodes,
  flattenSpawnTree,
  foldMessageContent,
  spawnDescendantCount,
  spawnHasMoreCount,
  spawnRowName,
} from '@/lib/spawns';

const STATUS_META: Record<SpawnStatus, { label: string; dot: string; badge: string }> = {
  running: {
    label: '进行中',
    dot: 'bg-emerald-500',
    badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  idle: {
    label: '待命',
    dot: 'bg-amber-500',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  done: {
    label: '已完成',
    dot: 'bg-muted-foreground/40',
    badge: 'border-border bg-muted/40 text-muted-foreground',
  },
};

/** RFC3339 → "MM-DD HH:mm" (local); unparseable input is shown verbatim. */
function fmtSpawnTime(value?: string): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type SpawnsState =
  | { kind: 'loading' }
  | { kind: 'ok'; workers: ProjectWorkerSpawns[] }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

type MessagesState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: SpawnMessagesResponse }
  | { kind: 'empty' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

// ----- one message row -----

function SpawnMessageRow({ message }: { message: SpawnMessage }) {
  const [expanded, setExpanded] = useState(false);
  const { text, folded } = foldMessageContent(message.content);
  const role = message.role || '?';
  const when = fmtSpawnTime(message.created_at);

  return (
    <div className="min-w-0 border-l-2 pl-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Badge
          variant="outline"
          className={`text-[11px] ${
            role === 'user'
              ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
              : 'border-sky-500/40 text-sky-700 dark:text-sky-400'
          }`}
        >
          {role}
        </Badge>
        {message.name && <span className="text-xs font-medium">{message.name}</span>}
        {when && <span className="text-[11px] text-muted-foreground">{when}</span>}
      </div>
      {message.content && (
        <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed">
          {expanded ? message.content : text}
        </div>
      )}
      {folded && (
        <Button
          variant="link"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="min-h-11 px-0 text-xs"
        >
          {expanded ? '收起' : '展开'}
        </Button>
      )}
    </div>
  );
}

// ----- lazy message stream for one spawn session -----

export function SpawnSessionMessages({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<MessagesState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    getSpawnMessages(projectId, sessionId, { signal: controller.signal })
      .then((data) => setState({ kind: 'ok', data }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const cls = classifySpawnError(e);
        if (cls === 'unsupported') setState({ kind: 'empty' });
        else if (cls === 'forbidden') setState({ kind: 'forbidden' });
        else setState({ kind: 'error', message: shortErrorMessage(e) });
      });
    return () => controller.abort();
  }, [projectId, sessionId, tick]);

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> 加载中…
      </p>
    );
  }
  if (state.kind === 'empty') {
    return <p className="text-xs text-muted-foreground">暂无消息</p>;
  }
  if (state.kind === 'forbidden') {
    return <p className="text-xs text-red-600 dark:text-red-400">无权限查看</p>;
  }
  if (state.kind === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTick((v) => v + 1)}
          className="min-h-11 text-xs"
        >
          加载失败 · 重试
        </Button>
        {state.message && (
          <span className="min-w-0 break-words text-[11px] text-muted-foreground">
            {state.message}
          </span>
        )}
      </div>
    );
  }

  const messages = state.data.messages;
  if (messages.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无消息</p>;
  }
  const moreCount = spawnHasMoreCount(state.data.has_more, messages.length);
  return (
    <div className="min-w-0 space-y-2">
      <ScrollArea className="max-h-72 w-full">
        <div className="space-y-2 pr-2">
          {messages.map((message, i) => (
            <SpawnMessageRow key={message.seq ?? `idx-${i}`} message={message} />
          ))}
        </div>
      </ScrollArea>
      {moreCount > 0 && (
        <p className="text-[11px] text-muted-foreground">仅显示最近 {moreCount} 条</p>
      )}
    </div>
  );
}

// ----- one tree node (recursive rows are flattened before rendering) -----

function SpawnNodeRow({
  node,
  depth,
  hasChildren,
  collapsed,
  onToggleCollapse,
  projectId,
  messagesOpen,
  onToggleMessages,
}: {
  node: SpawnNode;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  projectId: string;
  messagesOpen: boolean;
  onToggleMessages: () => void;
}) {
  const meta = STATUS_META[node.status];
  const last = fmtSpawnTime(node.last_activity);
  const created = fmtSpawnTime(node.created_at);
  const descendants = spawnDescendantCount(node);
  const tools = node.allowedTools ?? [];
  const skills = node.skills ?? [];

  return (
    <div className="min-w-0">
      <div
        className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1"
        style={{ paddingLeft: depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={`展开或收起 ${spawnRowName(node)}`}
            className="flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-11 shrink-0" aria-hidden />
        )}
        <span
          aria-hidden
          title="子会话状态"
          className={`size-2 shrink-0 rounded-full ${meta.dot}`}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={node.session_id}>
          {spawnRowName(node)}
        </span>
        <Badge variant="outline" className={`shrink-0 text-[11px] ${meta.badge}`}>
          {meta.label}
        </Badge>
        {descendants > 0 && (
          <Badge variant="outline" className="shrink-0 text-[11px] text-muted-foreground">
            {descendants} 子会话
          </Badge>
        )}
        {last && (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            title={`最近活动 ${node.last_activity}`}
          >
            {last}
          </span>
        )}
        {created && (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            title={`创建于 ${node.created_at}`}
          >
            创建 {created}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={messagesOpen}
          onClick={onToggleMessages}
          className="min-h-11 shrink-0 gap-1 text-xs"
        >
          <MessageSquare className="h-3.5 w-3.5" /> 消息
        </Button>
      </div>

      {(tools.length > 0 || skills.length > 0) && (
        <div
          className="flex flex-wrap items-center gap-1 pb-1"
          style={{ paddingLeft: depth * 14 + 52 }}
        >
          {tools.length > 0 && (
            <>
              <span className="text-[11px] text-muted-foreground">工具白名单</span>
              {tools.map((tool) => (
                <Badge key={`tool-${tool}`} variant="outline" className="text-[11px]">
                  {tool}
                </Badge>
              ))}
            </>
          )}
          {skills.length > 0 && (
            <>
              <span className="ml-2 text-[11px] text-muted-foreground">技能白名单</span>
              {skills.map((skill) => (
                <Badge
                  key={`skill-${skill}`}
                  variant="outline"
                  className="border-sky-500/40 text-[11px] text-sky-700 dark:text-sky-400"
                >
                  {skill}
                </Badge>
              ))}
            </>
          )}
        </div>
      )}

      {messagesOpen && (
        <div className="min-w-0 pb-2" style={{ paddingLeft: depth * 14 + 52 }}>
          <SpawnSessionMessages projectId={projectId} sessionId={node.session_id} />
        </div>
      )}
    </div>
  );
}

// ----- the card -----

function SpawnWorkerGroup({
  group,
  projectId,
}: {
  group: ProjectWorkerSpawns;
  projectId: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set<string>());
  const [openMessages, setOpenMessages] = useState<Set<string>>(() => new Set<string>());
  const forest = buildSpawnForest(group.spawns);
  const rows = flattenSpawnTree(forest, collapsed);

  const toggle = (setter: typeof setCollapsed, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-xs font-semibold">{group.worker}</span>
        <Badge variant="outline" className="text-[11px] text-muted-foreground">
          {countSpawnNodes(forest)}
        </Badge>
      </div>
      {rows.length === 0 ? (
        <p className="pl-1 text-[11px] text-muted-foreground">该 Worker 暂无子会话</p>
      ) : (
        rows.map(({ node, depth, hasChildren }) => (
          <SpawnNodeRow
            key={node.session_id}
            node={node}
            depth={depth}
            hasChildren={hasChildren}
            collapsed={collapsed.has(node.session_id)}
            onToggleCollapse={() => toggle(setCollapsed, node.session_id)}
            projectId={projectId}
            messagesOpen={openMessages.has(node.session_id)}
            onToggleMessages={() => toggle(setOpenMessages, node.session_id)}
          />
        ))
      )}
    </div>
  );
}

export function ProjectSpawnsPanel({
  projectId,
  teamId,
}: {
  projectId: string;
  teamId?: string;
}) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<SpawnsState>({ kind: 'loading' });

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setState((prev) => (prev.kind === 'ok' ? prev : { kind: 'loading' }));
    getProjectSpawns(projectId, teamId, controller.signal)
      .then((resp) => setState({ kind: 'ok', workers: resp.workers }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (classifySpawnError(e) === 'unsupported') {
          setState({ kind: 'unsupported' });
        } else {
          setState({ kind: 'error', message: shortErrorMessage(e) });
        }
      });
    return () => controller.abort();
  }, [projectId, teamId, tick]);

  // No project id → nothing to address; endpoint absent → hide the whole block.
  if (!projectId || state.kind === 'unsupported') return null;

  const total =
    state.kind === 'ok'
      ? state.workers.reduce((sum, group) => sum + countSpawnNodes(buildSpawnForest(group.spawns)), 0)
      : null;
  const subtitle =
    state.kind === 'loading'
      ? '加载中…'
      : state.kind === 'error'
        ? '加载失败'
        : total
          ? `按 Worker 分组 · 共 ${total} 个`
          : '暂无子会话';

  let body: ReactNode = null;
  if (state.kind === 'loading') {
    body = (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> 加载中…
      </p>
    );
  } else if (state.kind === 'error') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTick((v) => v + 1)}
          className="min-h-11 text-xs"
        >
          加载失败 · 重试
        </Button>
        {state.message && (
          <span className="min-w-0 break-words text-[11px] text-muted-foreground">
            {state.message}
          </span>
        )}
      </div>
    );
  } else if (state.workers.length === 0) {
    body = <p className="text-xs text-muted-foreground">暂无子会话</p>;
  } else {
    body = (
      <ScrollArea className="max-h-[420px] w-full">
        <div className="space-y-2 pr-2">
          {state.workers.map((group) => (
            <SpawnWorkerGroup key={group.worker} group={group} projectId={projectId} />
          ))}
        </div>
      </ScrollArea>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">
          <Users className="h-4 w-4" />
          子会话
          {total !== null && total > 0 && (
            <Badge variant="outline" className="text-[11px]">
              {total}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新子会话"
            title="刷新子会话"
            onClick={() => setTick((v) => v + 1)}
            className="size-11"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="min-w-0">{body}</CardContent>
    </Card>
  );
}
