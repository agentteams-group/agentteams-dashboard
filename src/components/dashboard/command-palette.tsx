'use client';

import { useMemo, useState, useEffect, useRef, type RefObject } from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import type { WorkerResponse, TeamResponse, ManagerResponse, HumanResponse } from '@/lib/agentteams-api';
import { isNavItemVisible, navItems, type DeploymentMode } from './nav-items';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSkills } from '@/hooks/use-skill-center';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';
import { mergeMainTaskIndex, useTaskIndex } from '@/hooks/use-projects';
import { isComposing } from '@/lib/desktop-interactions';
import { workspaceMenus, workspaceMenuFor } from './workspace-navigation';
import { useRoomMetaStore, useMatrixMessageSearch } from '@/hooks/use-matrix';
import { useMergedTaskBoard } from '@/hooks/use-task-board';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { readDrafts } from './sections/loops-section';
import { shortUserId } from './sections/chat/format';
import { highlightSnippet, searchableBody } from '@/lib/matrix-search';
import { auditHash, hashForSection, loopHash, platformAssistantSettingsHash, roomHash, tasksHash } from '@/lib/nav-hash';

export interface SearchResult {
  entity:
    | 'task'
    | 'project'
    | 'loop'
    | 'skill'
    | 'tool'
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

const ENTITY_LABELS = {
  task: '任务',
  project: '项目',
  loop: '自动化',
  skill: '技能',
  tool: '工具',
  worker: 'Agent',
  team: '团队',
  manager: 'Agent',
  human: '用户',
  room: '房间',
  message: '消息',
  'message-notice': '消息检索',
  'audit-event': '审计事件',
  section: '页面',
} as const;

/** 同等匹配度时，优先展示页面，再展示资源。 */
const PALETTE_ORDER = [
  'section',
  'task',
  'project',
  'skill',
  'tool',
  'loop',
  'worker',
  'team',
  'manager',
  'human',
  'room',
  'message',
  'message-notice',
  'audit-event',
] as const;

const sectionItems = Array.from(new Map([...workspaceMenus, ...navItems].map(item => [item.id, item])).values());
const shortcutSections = workspaceMenus.flatMap(menu =>
  menu.id === 'workbench' ? menu.sections : ['overview', 'chat', 'my-teams'].includes(menu.id) ? [menu.id] : []
);

function resourceSearchHash(section: 'skills' | 'tools', name: string) {
  return `#${hashForSection(section)}?q=${encodeURIComponent(name)}`;
}

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
  options: { enabled?: boolean; mode?: DeploymentMode | null } = {}
): SearchResult[] {
  const roomMeta = useRoomMetaStore((s) => s.meta);
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const taskBoardVisible = useAgentTeamsStore(state => state.taskBoardVisible);
  const q = query.toLowerCase().trim();
  const mode = options.mode;
  const sections = useMemo(() => sectionItems.flatMap(item => {
    const nav = navItems.find(nav => nav.id === item.id);
    if (nav && !isNavItemVisible(nav, mode, taskBoardVisible, userLevel)) return [];
    const group = workspaceMenuFor(item.id)?.label ?? '设置';
    return [{
      entity: 'section' as const,
      name: item.id === 'chat' ? 'AgentTeams助手' : item.label,
      subtitle: group,
      phase: group,
      section: item.id,
    }];
  }), [mode, taskBoardVisible, userLevel]);
  // 四类新实体（方案 v3 C-2）：只在面板开着时拉，并且关掉轮询——
  // 顶栏不该为搜索常驻一个 8s/15s 的后台拉取（看板与审计页自己会拉，
  // 共同一个 queryKey，面板只是提前读一眼缓存）。
  const enabled = options.enabled !== false && q.length > 0;
  const board = useMergedTaskBoard({ enabled, refetchInterval: false });
  const taskIndex = useTaskIndex({ enabled: enabled && taskBoardVisible, refetchInterval: false });
  const skills = useSkills(query.trim() || undefined, null, 1, 5, { enabled });
  const tools = useMcpServers({ enabled });
  const audit = useAuditEvents({ limit: 100 }, { enabled, refetchInterval: false });
  // 跨房间消息（方案 v3 B-1 的延伸）：只在面板开着、词够长时打 /search（长度门在 hook 里）。
  const messages = useMatrixMessageSearch(query, { enabled });
  // 循环只存在本地草案里（发布前服务端没有循环列表），面板开一次重读一次。
  const loopDrafts = useMemo(() => (enabled ? readDrafts() : []), [enabled]);

  return useMemo(() => {
    if (!q) return sections.filter(hit => shortcutSections.includes(hit.section));

    const results: SearchResult[] = [];

    sections.forEach(hit => {
      if (hit.name.toLowerCase().includes(q)
        || workspaceMenus.some(menu => menu.id === hit.section && menu.label.toLowerCase().includes(q))
        || (hit.section === 'chat' && 'at助手'.includes(q))
        || (hit.section === 'skills' && '技能管理'.includes(q))
        || (hit.section === 'tools' && 'mcp 工具'.includes(q))) results.push(hit);
    });

    for (const skill of skills.data?.skills ?? []) {
      results.push({ entity: 'skill', name: skill.name, subtitle: skill.description, phase: '', section: 'skills', hash: resourceSearchHash('skills', skill.name) });
    }

    for (const tool of tools.data ?? []) {
      if (tool.name.toLowerCase().includes(q) || tool.description?.toLowerCase().includes(q)) {
        results.push({ entity: 'tool', name: tool.name, subtitle: tool.description ?? '', phase: '', section: 'tools', hash: resourceSearchHash('tools', tool.name) });
      }
    }

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

    const indexedTasks = taskBoardVisible ? mergeMainTaskIndex(board.tasks, taskIndex.data?.tasks ?? []) : [];
    indexedTasks.forEach((t) => {
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
          hash: `${tasksHash()}?${new URLSearchParams({ task: t.runId, ...(t.teamId ? { team: t.teamId } : {}) })}`,
        });
      }
    });

    // 项目（C-2）
    (taskBoardVisible ? board.projects : []).forEach((p) => {
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
          hash: `#${hashForSection('workers')}?agent=${encodeURIComponent(w.name)}`,
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
          hash: `#${hashForSection('teams')}?team=${encodeURIComponent(t.name)}`,
        });
      }
    });

    // Search managers
    (userLevel >= 3 ? managers : [])?.forEach((m) => {
      if (
        m.name.toLowerCase().includes(q) ||
        (m.name === 'default' && 'agentteams助手 at助手'.includes(q)) ||
        m.model?.toLowerCase().includes(q) ||
        m.runtime?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'manager',
          name: m.name === 'default' ? 'AgentTeams助手' : m.name,
          subtitle: `${m.runtime || '-'} · ${m.model || '-'}`,
          phase: m.phase,
          section: 'platform-assistant-settings',
          hash: platformAssistantSettingsHash(m.name),
        });
      }
    });

    // Search humans
    (userLevel >= 3 ? humans : [])?.forEach((h) => {
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
  }, [query, q, sections, taskBoardVisible, userLevel, workers, teams, managers, humans, roomMeta, board.tasks, board.projects, taskIndex.data, skills.data, tools.data, audit.data, loopDrafts, messages.data, messages.isError]);
}

export function CommandPalette({ results, onSelect, onClose, inputRef, query = '', loading = false }: {
  results: SearchResult[];
  onSelect: (_result: SearchResult) => void;
  onClose: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  query?: string;
  loading?: boolean;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [keyboardSelection, setKeyboardSelection] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selectable = useMemo(() => results.filter(result => result.entity !== 'message-notice'), [results]);
  const activeIndex = Math.min(selectedIdx, Math.max(0, selectable.length - 1));
  const notices = results.filter(result => result.entity === 'message-notice');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isComposing() || (inputRef && document.activeElement !== inputRef.current)) return;
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (!selectable.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setKeyboardSelection(true);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSelectedIdx((activeIndex + step + selectable.length) % selectable.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onSelect(selectable[activeIndex]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, inputRef, onClose, onSelect, selectable]);

  useEffect(() => {
    if (!keyboardSelection) return;
    listRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, keyboardSelection]);

  return (
    <div ref={listRef} role="region" aria-label={query ? '工作区搜索结果' : '常用页面'}
      className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[min(24rem,60dvh)] overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl custom-scrollbar">
      {!results.length && <p role="status" className="px-3 py-3 text-sm text-muted-foreground">{loading ? '正在搜索…' : '没有找到匹配结果'}</p>}
      {selectable.map((result, index) => (
        <button
          key={`${result.entity}-${index}-${result.name}`}
          type="button"
          aria-label={result.entity === 'section' || result.entity === 'message' ? undefined : `${result.name} ${ENTITY_LABELS[result.entity]}`}
          data-search-index={index}
          data-highlighted={(!!query || keyboardSelection) && index === activeIndex}
          className="flex min-h-9 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent data-[highlighted=true]:bg-accent"
          onClick={() => onSelect(result)}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => setSelectedIdx(index)}
        >
          <span className="min-w-0">
            <span title={result.name} className="block truncate">{result.name}</span>
            {result.entity === 'message' && <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>}
          </span>
          {result.entity === 'section'
            ? <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            : <span className="shrink-0 text-xs text-muted-foreground">{ENTITY_LABELS[result.entity]}</span>}
        </button>
      ))}
      {notices.map(result => <p key={result.name} role="status" className="flex items-start gap-2 px-3 py-2 text-xs text-status-waiting">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{result.name}</span>
      </p>)}
    </div>
  );
}
