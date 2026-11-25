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
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  /** 子代理会话判据（QwenPaw ChatSpec 运行时口径，可选；旧 runtime 不投影）。 */
  meta?: Record<string, unknown> | null;
  parent_session_id?: string;
  root_session_id?: string;
  status?: string;
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

// ── 子代理会话（spawn）——运行时口径（移植自工作台插件 WorkerChatsShared）──
// QwenPaw 没有 /spawns 运行时路由：spawn 就是普通聊天会话，靠 ChatSpec
// 的 meta.spawn / source / session_id 前缀 / 父子链接区分（旧 runtime
// 只有前三种，无父子字段 → 树退化为扁平列表，不虚构层级）。

/** 会话树键：session_id 优先（父子链接都指向它），缺省回退 chat id。 */
export function spawnChatKey(c: ChatSpec): string {
  return String(c.session_id || c.id || '');
}

/** 是否子代理会话（QwenPaw ChatSpec 判据并集）。 */
export function isSpawnChat(c: ChatSpec): boolean {
  const meta = c.meta && typeof c.meta === 'object' ? c.meta : {};
  const sid = spawnChatKey(c);
  return (
    meta.spawn === true ||
    meta.spawn === 'true' ||
    c.source === 'spawn' ||
    // QwenPaw SessionSource 枚举实值（models.py:23）：chat | cron | subagent。
    c.source === 'subagent' ||
    sid.startsWith('sub-') ||
    !!c.parent_session_id ||
    !!c.root_session_id
  );
}

/** 树行：chat + 缩进深度 + 是否有子节点（caret 判定）。 */
export interface SpawnChatRow {
  chat: ChatSpec;
  depth: number;
  hasChildren: boolean;
}

/** spawn 会话 → 扁平树行。父 session 不在本列表（属普通智能体会话）→
 * 该 spawn 落根层；无 parent 字段的旧 runtime 全部落根层（扁平列表）。 */
export function buildSpawnChatRows(
  chats: ChatSpec[],
  collapsed: ReadonlySet<string> = new Set<string>(),
): SpawnChatRow[] {
  const byKey = new Map<string, ChatSpec>();
  for (const c of chats) {
    const k = spawnChatKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  }
  const kids = new Map<string, ChatSpec[]>();
  const roots: ChatSpec[] = [];
  for (const c of chats) {
    const parentId = c.parent_session_id || '';
    const parent = parentId ? byKey.get(parentId) : undefined;
    if (parent && parent !== c) {
      const k = spawnChatKey(parent);
      const arr = kids.get(k) ?? [];
      arr.push(c);
      kids.set(k, arr);
    } else {
      roots.push(c);
    }
  }
  const byUpdated = (a: ChatSpec, b: ChatSpec) =>
    String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  roots.sort(byUpdated);
  for (const arr of kids.values()) arr.sort(byUpdated);
  const out: SpawnChatRow[] = [];
  const seen = new Set<string>();
  // 折叠节点的整棵子树标记为「有意隐藏」——末段兜底不得把它们当孤儿补回。
  const markHidden = (list: ChatSpec[]): void => {
    for (const c of list) {
      const k = spawnChatKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      markHidden(kids.get(k) ?? []);
    }
  };
  const walk = (list: ChatSpec[], depth: number): void => {
    for (const c of list) {
      const k = spawnChatKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      const children = kids.get(k) ?? [];
      out.push({ chat: c, depth, hasChildren: children.length > 0 });
      if (children.length > 0) {
        if (collapsed.has(k)) markHidden(children);
        else walk(children, depth + 1);
      }
    }
  };
  walk(roots, 0);
  // 父链成环/重复键（数据脏）时的兜底：未走到的会话仍以根层展示，不丢行。
  for (const c of chats) {
    const k = spawnChatKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ chat: c, depth: 0, hasChildren: false });
  }
  return out;
}

/** spawn 树缩进（深度 → 静态 class，避免动态内联样式）。 */
const DEPTH_PAD = ['pl-1.5', 'pl-6', 'pl-[42px]', 'pl-[60px]'];

export function WorkerChatsPanel({
  workerName,
  showKindTabs = false,
}: {
  workerName: string;
  /** 顶层「智能体会话 / 子代理会话」双 tab（Worker 详情「会话」卡用；
   * 默认关闭 = 房间抽屉原行为不变，ChatRoom 等既有消费者不受影响）。 */
  showKindTabs?: boolean;
}) {
  const base = `/api/agentteams/workers/${encodeURIComponent(workerName)}/chats`;

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [chats, setChats] = useState<ChatSpec[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [detailState, setDetailState] = useState<LoadState>('loading');
  const [detailError, setDetailError] = useState('');
  const [chatStatus, setChatStatus] = useState<ChatStatus>('');
  // 顶层会话类别（showKindTabs 生效时）：智能体会话 = 非 spawn；子代理 = spawn。
  const [kind, setKind] = useState<'agent' | 'spawn'>('agent');
  const [spawnCollapsed, setSpawnCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggleSpawnCollapsed = useCallback((key: string) => {
    setSpawnCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  // 双 tab 模式按 spawn 标记分流（同一运行时列表，互斥，不重复展示）；
  // showKindTabs=false（房间抽屉）= 全量走原语义。
  const agentChats = showKindTabs ? chats.filter((c) => !isSpawnChat(c)) : chats;
  const spawnChats = showKindTabs ? chats.filter(isSpawnChat) : [];
  const spawnRows = showKindTabs ? buildSpawnChatRows(spawnChats, spawnCollapsed) : [];

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
            <Badge variant="secondary" className="text-xs">
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

        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
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
              <p className="px-2 py-1 text-xs text-muted-foreground">该会话暂无消息。</p>
            )}
            {msgs.map((m, i) => {
              const blocks = Array.isArray(m.content)
                ? m.content.map(renderContentBlock)
                : [renderContentBlock(m.content)];
              return (
                <div key={m.id ?? i} className="rounded-md border border-border/60 px-2 py-1.5">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      {m.role || m.type || 'message'}
                    </span>
                  </div>
                  {blocks
                    .filter((b) => b.length > 0)
                    .map((b, j) => (
                      <p
                        key={j}
                        // `break-all` (vs `break-words`) keeps whitespace in
                        // the original text but lets long uuids / tool names
                        // wrap anywhere, so the narrow dialog column doesn't
                        // force mid-word mid-character wraps that hurt
                        // readability. Tailwind's `break-words` is the same
                        // as `overflow-wrap: anywhere` and only breaks
                        // inside the last possible word on the line.
                        className="whitespace-pre-wrap break-all text-xs font-mono"
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
  const listHeader = (
    <div className="flex items-center justify-between">
      <p className="text-muted-foreground">会话（只读 · Agent 上下文）</p>
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
        <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
        刷新
      </Button>
    </div>
  );

  const chatRows = (list: ChatSpec[]) => (
    <div className="space-y-1">
      {list.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          当前账号在此 Worker 的可见范围内没有会话（L2 仅自己所在房间）。
        </p>
      )}
      {list.map((c) => (
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
              {c.pinned && <Badge variant="secondary" className="h-4 px-1 text-xs">置顶</Badge>}
              {c.archived && (
                <Badge variant="outline" className="h-4 px-1 text-xs text-muted-foreground">
                  已归档
                </Badge>
              )}
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {c.id}
              {c.channel ? ` · ${c.channel}` : ''}
              {c.updated_at ? ` · ${formatTs(c.updated_at)}` : ''}
            </p>
          </div>
        </button>
      ))}
    </div>
  );

  const spawnTree = (
    <div className="grid gap-1">
      {spawnRows.length === 0 && (
        <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
          暂无子代理会话（该 Worker 当前没有子代理会话）。
        </p>
      )}
      {spawnRows.map(({ chat, depth, hasChildren }) => {
        const rowKey = spawnChatKey(chat);
        const collapsed = spawnCollapsed.has(rowKey);
        return (
          <div
            key={rowKey}
            role="button"
            tabIndex={0}
            aria-label={`查看会话 ${chat.session_id || chat.id}`}
            onClick={() => void openChat(chat.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void openChat(chat.id);
              }
            }}
            className={`flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 py-1 pr-2 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${DEPTH_PAD[Math.min(depth, DEPTH_PAD.length - 1)]}`}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-label="展开/收起子会话"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSpawnCollapsed(rowKey);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              >
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="w-11 shrink-0" aria-hidden="true" />
            )}
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">
                  {chat.name || chat.id.slice(0, 8)}
                </span>
                {chat.pinned && <Badge variant="secondary" className="h-4 px-1 text-xs">置顶</Badge>}
                {chat.archived && (
                  <Badge variant="outline" className="h-4 px-1 text-xs text-muted-foreground">
                    已归档
                  </Badge>
                )}
                {chat.status && (
                  <Badge
                    variant={chat.status === 'running' ? 'default' : 'secondary'}
                    className="h-4 px-1 text-xs"
                  >
                    {chat.status}
                  </Badge>
                )}
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {chat.id}
                {chat.channel ? ` · ${chat.channel}` : ''}
                {chat.updated_at ? ` · ${formatTs(chat.updated_at)}` : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );

  // 顶层双 tab：智能体会话（非 spawn）/ 子代理会话（spawn）——两个 tab 同一
  // 数据面（运行时 /workers/{name}/chats），不重叠。
  if (showKindTabs) {
    return (
      <div className="pt-2">
        <Tabs
          value={kind}
          onValueChange={(v) => {
            setKind(v === 'spawn' ? 'spawn' : 'agent');
            setOpenId(null);
            setDetail(null);
            setDetailState('loading');
            setDetailError('');
            setChatStatus('');
          }}
        >
          <TabsList className="h-9 w-fit">
            <TabsTrigger value="agent" className="text-xs">
              智能体会话 ({agentChats.length})
            </TabsTrigger>
            <TabsTrigger value="spawn" className="text-xs">
              子代理会话 ({spawnChats.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="agent" className="space-y-2">
            {listHeader}
            {chatRows(agentChats)}
          </TabsContent>
          <TabsContent value="spawn" className="space-y-2">
            {listHeader}
            {spawnTree}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2">
      {listHeader}
      {chatRows(chats)}
    </div>
  );
}
