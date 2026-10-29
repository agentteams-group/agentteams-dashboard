'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot,
  Users,
  Crown,
  UserCheck,
  ArrowRight,
  MessageSquare,
  MessageSquareText,
  AlertTriangle,
  Compass,
  ListTodo,
  FolderKanban,
  RefreshCcw,
  ScrollText,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { WorkerResponse, TeamResponse, ManagerResponse, HumanResponse } from '@/lib/agentteams-api';
import { navItems, navAreas } from './nav-items';
import { useRoomMetaStore, useMatrixMessageSearch } from '@/hooks/use-matrix';
import { useMergedTaskBoard } from '@/hooks/use-task-board';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { readDrafts } from './sections/loops-section';
import { shortUserId } from './sections/chat/format';
import { highlightSnippet, searchableBody } from '@/lib/matrix-search';
import { auditHash, loopHash, roomHash, tasksHash } from '@/lib/nav-hash';

export interface SearchResult {
  entity:
    | 'task'
    | 'project'
    | 'loop'
    | 'worker'
    | 'team'
    | 'manager'
    | 'human'
    | 'room'
    | 'message'
    /**
     * 跨房间消息检索的状态行（能力缺失 / 请求失败）。它不是命中，面板按纯文本
     * 渲染、不可点开：把「搜不了」和「没有」混进同一类结果正是 B-1 要防的事。
     */
    | 'message-notice'
    | 'audit-event'
    | 'section';
  name: string;
  subtitle: string;
  phase: string;
  section: string;
  /** Set for room hits: the palette deep-links straight into the room. */
  roomId?: string;
  /**
   * 带参数的分层深链（含 leading '#'）。比 `section` 精细：任务/项目会选中
   * 所属项目，循环会选中那条循环，审计事件会把实体类型筛选切过去。
   * 导航仍然只写 hash，由 `use-active-section` 的 hashchange 解析（C-1 同一约定）。
   */
  hash?: string;
}

const ENTITY_ICONS = {
  task: ListTodo,
  project: FolderKanban,
  loop: RefreshCcw,
  worker: Bot,
  team: Users,
  manager: Crown,
  human: UserCheck,
  room: MessageSquare,
  message: MessageSquareText,
  'message-notice': AlertTriangle,
  'audit-event': ScrollText,
  section: Compass,
} as const;

const ENTITY_COLORS = {
  task: 'text-sky-500',
  project: 'text-violet-500',
  loop: 'text-sky-500',
  worker: 'text-emerald-500',
  team: 'text-emerald-500',
  manager: 'text-violet-500',
  human: 'text-cyan-500',
  room: 'text-sky-500',
  message: 'text-status-info',
  'message-notice': 'text-status-waiting',
  'audit-event': 'text-amber-500',
  section: 'text-amber-500',
} as const;

const ENTITY_LABELS = {
  task: '任务',
  project: '项目',
  loop: '循环',
  worker: 'Worker',
  team: '团队',
  manager: 'Manager',
  human: '用户',
  room: '房间',
  message: '消息',
  'message-notice': '消息检索',
  'audit-event': '审计事件',
  section: '页面',
} as const;

/** 面板分组渲染顺序：要做的事 → 实体 → 导航目的地。 */
const PALETTE_ORDER = [
  'task',
  'project',
  'loop',
  'worker',
  'team',
  'manager',
  'human',
  'room',
  'message',
  'message-notice',
  'audit-event',
  'section',
] as const;

const AREA_LABELS = Object.fromEntries(navAreas.map((a) => [a.id, a.label]));

/**
 * Static navigation destinations (PRD §5.3 命令面板兜底): every nav item is
 * reachable by typing its label, which also eases the Workbench IA migration.
 */
const SECTION_HITS: SearchResult[] = navItems.map((item) => ({
  entity: 'section',
  name: item.label,
  subtitle: AREA_LABELS[item.area] ?? '',
  phase: AREA_LABELS[item.area] ?? '',
  section: item.id,
}));

/**
 * 消息检索的状态行（服务端不支持 / 请求失败）。
 *
 * 借 SearchResult 的壳只是为了走同一条渲染与截断路径；`entity` 是
 * `message-notice`，面板把它渲染成没有按钮的说明文本，不参与键盘序号。
 */
function messageNotice(text: string): SearchResult {
  return { entity: 'message-notice', name: text, subtitle: '', phase: '', section: 'chat' };
}

export function useGlobalSearch(
  query: string,
  workers?: WorkerResponse[],
  teams?: TeamResponse[],
  managers?: ManagerResponse[],
  humans?: HumanResponse[],
  options: { enabled?: boolean } = {}
): SearchResult[] {
  const roomMeta = useRoomMetaStore((s) => s.meta);
  // 四类新实体（方案 v3 C-2）：只在面板开着时拉，并且关掉轮询——
  // 顶栏不该为搜索常驻一个 8s/15s 的后台拉取（看板与审计页自己会拉，
  // 共同一个 queryKey，面板只是提前读一眼缓存）。
  const enabled = options.enabled !== false;
  const board = useMergedTaskBoard({ enabled, refetchInterval: false });
  const audit = useAuditEvents({ limit: 100 }, { enabled, refetchInterval: false });
  // 跨房间消息（方案 v3 B-1 的延伸）：只在面板开着、词够长时打 /search（长度门在 hook 里）。
  const messages = useMatrixMessageSearch(query, { enabled });
  // 循环只存在本地草案里（发布前服务端没有循环列表），面板开一次重读一次。
  const loopDrafts = useMemo(() => (enabled ? readDrafts() : []), [enabled]);

  return useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q || q.length < 2) return [];

    const results: SearchResult[] = [];

    // Navigation destinations (label match only — static list)
    SECTION_HITS.forEach((hit) => {
      if (hit.name.toLowerCase().includes(q)) results.push(hit);
    });

    // Matrix rooms already known to the global sync loop (room meta is
    // populated by useGlobalMatrixSync regardless of the active section).
    Object.entries(roomMeta).forEach(([roomId, meta]) => {
      const name = meta.roomName || roomId;
      if (name.toLowerCase().includes(q)) {
        results.push({
          entity: 'room',
          name,
          subtitle: meta.lastMessagePreview || roomId,
          phase: meta.unreadCount ? `${meta.unreadCount} 未读` : '房间',
          section: 'chat',
          roomId,
        });
      }
    });

    // 跨房间消息（B-1 延伸）：标题用命中正文片段，副标题带所属房间名。
    // 房间名沿用上面 `room` 实体的同一取法（roomMeta.roomName），拿不到退回 room_id。
    const term = query.trim();
    (messages.data?.hits ?? []).forEach((hit) => {
      // /search 返回的事件自带 room_id；没有它就定位不到会话，宁可不给这条结果。
      const roomId = hit.event.room_id;
      if (!roomId) return;
      const body = searchableBody(hit.event);
      if (!body) return;
      const snippet = highlightSnippet(body, term);
      const meta = roomMeta[roomId];
      results.push({
        entity: 'message',
        name: snippet ? `${snippet.before}${snippet.match}${snippet.after}` : body,
        subtitle: `${meta?.roomName || roomId} · ${shortUserId(hit.event.sender)}`,
        phase: '消息',
        section: 'chat',
        roomId,
        // 深链到那个会话并带上词（D）：会话侧读到 q 就自动开搜索条并预填。
        hash: `${roomHash(roomId)}?q=${encodeURIComponent(term)}`,
      });
    });

    // 降级必须可见（B-1 硬要求）：服务端没有全文索引、或者请求挂了，都要把
    // 「搜不了」明写出来——这种情况下绝不能只渲染成「没有匹配的消息」。
    if (messages.data?.unsupported === true) {
      results.push(messageNotice(`该服务端不支持内容检索${messages.data.reason ? `（${messages.data.reason}）` : ''}`));
    } else if (messages.isError) {
      results.push(messageNotice('消息检索失败'));
    }

    // 任务（C-2）：命中后落到所属项目的看板视图。看板上的选中单元就是项目，
    // 任务没有自己的选中态，所以不伪造一个没人读的 ?task= 参数。
    board.tasks.forEach((t) => {
      if (
        t.title.toLowerCase().includes(q) ||
        t.runId.toLowerCase().includes(q) ||
        (t.assignedTo ?? '').toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'task',
          name: t.title,
          subtitle: `${t.runId} · 负责 ${t.assignedTo || '未分配'}`,
          phase: t.status,
          section: 'tasks',
          hash: tasksHash(t.projectId),
        });
      }
    });

    // 项目（C-2）
    board.projects.forEach((p) => {
      if (p.name.toLowerCase().includes(q) || p.runId.toLowerCase().includes(q)) {
        results.push({
          entity: 'project',
          name: p.name,
          subtitle: `${p.runId}${p.leader ? ` · 队长 ${p.leader}` : ''}`,
          phase: p.status,
          section: 'tasks',
          hash: tasksHash(p.runId),
        });
      }
    });

    // 循环草案（C-2）
    loopDrafts.forEach((draft) => {
      if (
        draft.name.toLowerCase().includes(q) ||
        (draft.definition.description ?? '').toLowerCase().includes(q)
      ) {
        const status = draft.definition.status;
        results.push({
          entity: 'loop',
          name: draft.name,
          subtitle: `${draft.definition.nodes.length} 个节点 · ${draft.id}`,
          phase: status === 'published' ? '已发布' : status === 'archived' ? '已归档' : '草稿',
          section: 'loops',
          hash: loopHash(draft.id),
        });
      }
    });

    // 审计事件（C-2）：命中后把审计页的实体类型筛选切到那一类（现有筛选维度）。
    (audit.data?.events ?? []).forEach((event) => {
      if (
        event.entity_name.toLowerCase().includes(q) ||
        event.action.toLowerCase().includes(q) ||
        (event.actor ?? '').toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'audit-event',
          name: `${event.action} · ${event.entity_name}`,
          subtitle: `${event.actor ?? '系统'} · ${new Date(event.timestamp).toLocaleString('zh-CN', { hour12: false })}`,
          phase: event.severity === 'error' ? '错误' : event.severity === 'warning' ? '警告' : '记录',
          section: 'audit',
          hash: auditHash(event.entity_type),
        });
      }
    });

    // Search workers
    workers?.forEach((w) => {
      if (
        w.name.toLowerCase().includes(q) ||
        (w.model || '').toLowerCase().includes(q) ||
        (w.runtime || '').toLowerCase().includes(q) ||
        (w.team || '').toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'worker',
          name: w.name,
          subtitle: `${w.runtime} · ${w.model || '无模型'}`,
          phase: w.phase,
          section: 'workers',
        });
      }
    });

    // Search teams
    teams?.forEach((t) => {
      if (
        t.name.toLowerCase().includes(q) ||
        t.teamName?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'team',
          name: t.teamName || t.name,
          subtitle: `${t.readyWorkers}/${t.totalWorkers} Workers · ${t.leaderName}`,
          phase: t.phase,
          section: 'teams',
        });
      }
    });

    // Search managers
    managers?.forEach((m) => {
      if (
        m.name.toLowerCase().includes(q) ||
        m.model?.toLowerCase().includes(q) ||
        m.runtime?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'manager',
          name: m.name,
          subtitle: `${m.runtime || '-'} · ${m.model || '-'}`,
          phase: m.phase,
          section: 'managers',
        });
      }
    });

    // Search humans
    humans?.forEach((h) => {
      if (
        h.name.toLowerCase().includes(q) ||
        h.displayName?.toLowerCase().includes(q) ||
        h.email?.toLowerCase().includes(q) ||
        h.matrixUserID?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'human',
          name: h.displayName || h.name,
          subtitle: h.email || h.matrixUserID || h.name,
          phase: h.phase,
          section: 'humans',
        });
      }
    });

    // Sort: exact name matches first, then by panel group order
    const orderIndex = new Map<string, number>(PALETTE_ORDER.map((e, i) => [e, i]));
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === q ? 0 : 1;
      const bExact = b.name.toLowerCase() === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return (orderIndex.get(a.entity) ?? 99) - (orderIndex.get(b.entity) ?? 99);
    });

    // 每类最多 5 条再截总长：多了四类数据源后，一整屏任务会把房间和页面
    // 完全顶掉（方案的原意是「找得到任务」，不是「只找得到任务」）。
    const perType = new Map<string, number>();
    const capped = results.filter((r) => {
      const seen = perType.get(r.entity) ?? 0;
      if (seen >= 5) return false;
      perType.set(r.entity, seen + 1);
      return true;
    });
    return capped.slice(0, 24);
  }, [query, workers, teams, managers, humans, roomMeta, board.tasks, board.projects, audit.data, loopDrafts, messages.data, messages.isError]);
}

export function CommandPalette({
  results,
  onSelect,
  onClose,
}: {
  results: SearchResult[];
  onSelect: (_result: SearchResult) => void;
  onClose: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset selection when the result count changes (adjust state during render)
  const [prevResultCount, setPrevResultCount] = useState(results.length);
  if (prevResultCount !== results.length) {
    setPrevResultCount(results.length);
    setSelectedIdx(0);
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter' && results[selectedIdx]) {
        e.preventDefault();
        onSelect(results[selectedIdx]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, selectedIdx, onSelect, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (results.length === 0) return null;

  // Group by entity type
  const grouped = results.reduce(
    (acc, r) => {
      if (!acc[r.entity]) acc[r.entity] = [];
      acc[r.entity].push(r);
      return acc;
    },
    {} as Record<string, SearchResult[]>
  );

  let flatIdx = 0;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-xl max-h-80 overflow-y-auto custom-scrollbar z-50">
      <div ref={listRef} className="py-1">
        {PALETTE_ORDER.map((entityType) => {
          const items = grouped[entityType];
          if (!items || items.length === 0) return null;

          // 降级说明行：没有去处，所以不是按钮；也不占键盘序号（否则高亮
          // 会和列表错开一位）。同一个房间可能出现两条正文一模一样的命中，
          // 所以按钮的 key 靠序号而不只靠 entity+name。
          if (entityType === 'message-notice') {
            const NoticeIcon = ENTITY_ICONS['message-notice'];
            return (
              <div key={entityType} role="status">
                {items.map((result) => (
                  <p
                    key={result.name}
                    className="flex items-start gap-2 px-3 py-1.5 text-xs text-status-waiting"
                  >
                    <NoticeIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{result.name}</span>
                  </p>
                ))}
              </div>
            );
          }

          const Icon = ENTITY_ICONS[entityType];
          return (
            <div key={entityType}>
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {ENTITY_LABELS[entityType]} ({items.length})
              </div>
              {items.map((result) => {
                const idx = flatIdx++;
                return (
                  <button
                    key={`${result.entity}-${idx}-${result.name}`}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      idx === selectedIdx ? 'bg-accent' : 'hover:bg-accent/50'
                    }`}
                    onClick={() => onSelect(result)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${ENTITY_COLORS[result.entity]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{result.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {result.subtitle}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {result.phase}
                    </Badge>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
