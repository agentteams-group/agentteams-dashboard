'use client';

// C worker 会话只读面板（上游 #1295 等合并；issue #1293）——
// 给 AgentTeams 里的无头 QwenPaw Worker「补头」：
// 用户经 AgentTeams 即可看见 Worker 的 QwenPaw 会话（列表 → agent 上下文详情）。
//   · detail = **agent 上下文**（可能含压缩历史/未发送工具输出）——
//     必须标注，区别于实发房间消息（#1293 数据敏感性定案）
//   · L2 只见自己所在 Matrix 房间的会话（服务端强制 room 级边界）；
//     越权统一 404（W8 不可探测）——前端 404 = 占位横幅，不渲染空列表
//   · status 端点仅 QwenPaw ≥2.2.1：旧 runtime 404 → 隐藏状态灯（版本无关门）
//   · 只读：无发送/编辑面（上游端点只读，本层不造写路径）

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ChatSpec {
  id: string;
  name?: string;
  session_id?: string;
  user_id?: string;
  channel?: string;
  created_at?: string;
  updated_at?: string;
  pinned?: boolean;
  archived?: boolean;
  source?: string;
}

interface ChatMessage {
  id?: string;
  type?: string;
  role?: string;
  content: unknown;
  status?: string;
}

interface ChatDetail {
  messages?: ChatMessage[];
  status?: string;
}

type LoadState = 'loading' | 'ready' | 'hidden' | 'error';
type ChatStatus = '' | 'idle' | 'running';

function renderContentBlock(block: unknown): string {
  // content 块可含工具调用/结果（契约 extra=allow）——保守渲染，不猜 schema：
  // 文本块直出，工具块压成单行标签，其余 JSON 截断
  if (typeof block === 'string') return block;
  if (block && typeof block === 'object') {
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string') return b.text;
    const name =
      typeof b.name === 'string'
        ? b.name
        : typeof b.tool_name === 'string'
          ? b.tool_name
          : typeof b.type === 'string' && String(b.type).startsWith('tool')
            ? String(b.type)
            : '';
    if (name) return `🔧 ${name}`;
    try {
      const s = JSON.stringify(b);
      return s.length > 200 ? `${s.slice(0, 200)}…` : s;
    } catch {
      return '[不可序列化的内容块]';
    }
  }
  return String(block ?? '');
}

function formatTs(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WorkerChatsPanel({ workerName }: { workerName: string }) {
  const base = `/api/agentteams/workers/${encodeURIComponent(workerName)}/chats`;

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [chats, setChats] = useState<ChatSpec[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [detailState, setDetailState] = useState<LoadState>('loading');
  const [detailError, setDetailError] = useState('');
  const [chatStatus, setChatStatus] = useState<ChatStatus>('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: 'no-store' });
      // 404: unknown worker / L2 boundary / older Controller without #1295.
      // 403: known worker but the caller lacks read access (Controller
      //      RBAC returns 403 for workers outside the L2 user's scope).
      // Both are unprobeable from the client — render the same hidden
      // placeholder rather than a red error banner that tells the user
      // "you don't have permission" (information disclosure + noise).
      if (res.status === 404 || res.status === 403) {
        setState('hidden');
        return;
      }
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; message?: string; detail?: string };
          detail = body?.detail || body?.message || body?.error || detail;
        } catch {
          // non-JSON
        }
        setState('error');
        setLoadError(detail);
        return;
      }
      const data = (await res.json()) as ChatSpec[] | { chats?: ChatSpec[]; items?: ChatSpec[] };
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data.chats)
          ? data.chats
          : Array.isArray(data.items)
            ? data.items
            : [];
      setChats(list);
      setState('ready');
    } catch (err) {
      setState('error');
      setLoadError(err instanceof Error ? err.message : '网络错误');
    }
  }, [base]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const loadStatus = useCallback(
    async (chatId: string) => {
      try {
        const res = await fetch(`${base}/${encodeURIComponent(chatId)}/status`, {
          cache: 'no-store',
        });
        // 旧 runtime（<2.2.1）无 /status → 404 = 隐藏状态灯（版本无关门）
        if (!res.ok) {
          setChatStatus('');
          return;
        }
        const data = (await res.json()) as { status?: string };
        setChatStatus(data.status === 'running' ? 'running' : 'idle');
      } catch {
        setChatStatus('');
      }
    },
    [base],
  );

  const openChat = useCallback(
    async (chatId: string) => {
      setOpenId(chatId);
      setDetail(null);
      setDetailState('loading');
      setDetailError('');
      setChatStatus('');
      void loadStatus(chatId);
      try {
        const res = await fetch(`${base}/${encodeURIComponent(chatId)}`, { cache: 'no-store' });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string; message?: string; detail?: string };
            detail = body?.detail || body?.message || body?.error || detail;
          } catch {
            // non-JSON
          }
          // 403 = same RBAC boundary as the list endpoint — surface a soft
          // empty state (no red error), since the chat is in the sidebar
          // because the user CAN read the list, but the underlying chat
          // either moved rooms or is gated differently. Collapse to the
          // hidden placeholder so the dialog isn't trapped on an error
          // banner that re-opens every time the user clicks the avatar.
          if (res.status === 403 || res.status === 404) {
            setDetailState('hidden');
            setDetail(null);
            return;
          }
          setDetailState('error');
          setDetailError(detail);
          return;
        }
        const data = (await res.json()) as ChatDetail;
        setDetail(data);
        setDetailState('ready');
      } catch (err) {
        setDetailState('error');
        setDetailError(err instanceof Error ? err.message : '网络错误');
      }
    },
    [base, loadStatus],
  );

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        会话加载中…
      </div>
    );
  }

  if (state === 'hidden') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          当前无可见会话——仅可查看你所加入房间内的会话；Controller 版本未含会话端点或无该 Worker
          访问权时同样显示此提示。
        </span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <Loader2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">会话加载失败：{loadError}</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          重试
        </Button>
      </div>
    );
  }

  if (openId && detailState !== 'loading') {
    // ── 详情视图 ──
    const msgs = detail?.messages ?? [];
    return (
      <div className="space-y-2 pt-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpenId(null)}>
            <ArrowLeft className="mr-1 h-3 w-3" aria-hidden="true" />
            返回列表
          </Button>
          <span className="truncate font-mono text-xs">{openId}</span>
          {chatStatus === 'running' && (
            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              running
            </Badge>
          )}
          {chatStatus === 'idle' && (
            <Badge variant="secondary" className="text-[10px]">
              idle
            </Badge>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => void loadStatus(openId)}
          >
            <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
            刷新状态
          </Button>
        </div>

        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          Agent 上下文视图——可能含压缩历史与未发送的工具调用/输出，与实发房间消息不同。
        </div>

        {detailState === 'error' && (
          <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            详情加载失败：{detailError}
          </div>
        )}

        {detailState === 'hidden' && (
          <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
            该会话不可见（不在你的访问范围内，或 Controller 不再持有它）。
          </div>
        )}

        {detailState === 'ready' && (
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
            {msgs.length === 0 && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">该会话暂无消息。</p>
            )}
            {msgs.map((m, i) => {
              const blocks = Array.isArray(m.content)
                ? m.content.map(renderContentBlock)
                : [renderContentBlock(m.content)];
              return (
                <div key={m.id ?? i} className="rounded-md border border-border/60 px-2 py-1.5">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">
                      {m.role || m.type || 'message'}
                    </span>
                  </div>
                  {blocks
                    .filter((b) => b.length > 0)
                    .map((b, j) => (
                      <p
                        key={j}
                        className="whitespace-pre-wrap break-words text-xs"
                      >
                        {b}
                      </p>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── 列表视图 ──
  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">会话（只读 · Agent 上下文）</p>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          刷新
        </Button>
      </div>
      <div className="space-y-1">
        {chats.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">
            当前账号在此 Worker 的可见范围内没有会话（L2 仅自己所在房间）。
          </p>
        )}
        {chats.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => void openChat(c.id)}
            className="flex w-full items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-left hover:bg-muted/50"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">
                  {c.name || c.id.slice(0, 8)}
                </span>
                {c.pinned && <Badge variant="secondary" className="h-4 px-1 text-[10px]">置顶</Badge>}
                {c.archived && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
                    已归档
                  </Badge>
                )}
              </div>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {c.id}
                {c.channel ? ` · ${c.channel}` : ''}
                {c.updated_at ? ` · ${formatTs(c.updated_at)}` : ''}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
