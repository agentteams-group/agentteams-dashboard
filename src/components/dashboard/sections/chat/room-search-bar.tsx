'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMatrixRoomSearch } from '@/hooks/use-matrix';
import { formatDate, formatTime, shortUserId, type MemberMap } from '@/components/dashboard/sections/chat/format';
import type { MatrixEvent } from '@/lib/matrix-api';
import { highlightSnippet, searchableBody, searchInLoadedMessages, type RoomSearchHit } from '@/lib/matrix-search';

/** 命中不在已加载窗口时，最多往前翻几页去找（每页 50 条）。 */
const MAX_EARLIER_PAGES = 8;
/** 边打字边检索的节流：300ms 内继续输入就不打上游。 */
const DEBOUNCE_MS = 300;

interface RoomSearchBarProps {
  roomId: string;
  /** 当前已加载的原始事件：服务端不支持全文检索时的匹配范围。 */
  loadedEvents: MatrixEvent[];
  /** MXID → 成员显示名，命中行要显示「谁说的」。 */
  memberMap?: MemberMap;
  /** 定位一条消息；返回 true 表示已在当前时间线里找到并滚动过去。 */
  onReveal: (_eventId: string) => boolean;
  /** 再加载更早的一页；返回时新事件已进缓存。 */
  onLoadEarlier: () => Promise<unknown>;
  /**
   * 预填的检索词：命令面板命中跨房间消息后带 `?q=` 深链进来，
   * 搜索条得替用户把词准备好。只做初始值，不追打外部变化。
   */
  initialTerm?: string;
  onClose: () => void;
}

/** 命中行的一行摘要：发送者 + 时间 + 带 <mark> 的片段。 */
function HitRow({
  hit,
  term,
  memberMap,
  active,
  onSelect,
}: {
  hit: RoomSearchHit;
  term: string;
  memberMap?: MemberMap;
  active: boolean;
  onSelect: () => void;
}) {
  const body = searchableBody(hit.event);
  const snippet = highlightSnippet(body, term);
  const sender = memberMap?.[hit.event.sender] || shortUserId(hit.event.sender);
  const ts = hit.event.origin_server_ts ?? 0;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
          active ? 'bg-status-info/15 text-status-info' : 'hover:bg-muted text-card-foreground'
        }`}
      >
        <span className="flex items-center gap-2">
          <span className="font-medium shrink-0">{sender}</span>
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {formatDate(ts)} {formatTime(ts)}
          </span>
        </span>
        <span className="block truncate text-muted-foreground">
          {snippet ? (
            <>
              {snippet.before}
              <mark className="bg-status-info/25 text-status-info rounded-sm px-0.5">{snippet.match}</mark>
              {snippet.after}
            </>
          ) : (
            body || '（该消息没有可搜索的正文）'
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * 房间内容搜索条（方案 v3 B-1）：Ctrl/⌘+F 唤起，命中计数、上下跳转、点击定位。
 *
 * 为什么要有本地降级这条路：全文检索依赖 homeserver 开启消息索引（Synapse 的
 * `search_indexing_enabled`，运营者可以关）。关掉后上游返回错误而不是空结果，
 * 如果只按「0 条命中」渲染，用户会以为房间里没有这句话。所以这里区分两种情形，
 * 并在退回本地已加载消息匹配时把「仅覆盖已加载消息」明写出来，不静默。
 */
export function RoomSearchBar({
  roomId,
  loadedEvents,
  memberMap,
  onReveal,
  onLoadEarlier,
  initialTerm,
  onClose,
}: RoomSearchBarProps) {
  // 预填词直接进初始 state（含 debounced）：走 effect 去追打会让 300ms 去抖
  // 在挂载时再跑一遍，深链进房的那一下检索会被推迟，还可能盖掉用户已经改掉的输入。
  const [term, setTerm] = useState(initialTerm ?? '');
  const [debounced, setDebounced] = useState(initialTerm ?? '');
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchingEarlier, setSearchingEarlier] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [term]);

  const search = useMatrixRoomSearch(roomId, debounced, { enabled: debounced.trim().length >= 2 });
  const result = search.data;
  const unsupported = result?.unsupported === true || search.isError;

  const hits = useMemo<RoomSearchHit[]>(() => {
    if (debounced.trim().length < 2) return [];
    if (unsupported) return searchInLoadedMessages(loadedEvents, debounced);
    return result?.hits ?? [];
  }, [debounced, unsupported, result, loadedEvents]);

  // 换一轮检索就回到第一条，和浏览器内查找的肌肉记忆一致。
  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 深链预填时把光标落到词尾：用户要接着改词，不是覆盖它。
    const len = input.value.length;
    input.setSelectionRange(len, len);
    // 只在挂载那一次：依赖 term 会让每次按键都把光标弹到末尾。
  }, []);

  /**
   * 定位一条命中。已加载窗口内直接滚过去；不在窗口内就往前翻页继续找，
   * 翻到上限还没有就明确告诉用户「这条在更早的历史里，当前窗口没加载到」。
   */
  const reveal = useCallback(
    async (hit: RoomSearchHit) => {
      if (onReveal(hit.event.event_id)) return;
      setSearchingEarlier(true);
      try {
        for (let page = 0; page < MAX_EARLIER_PAGES; page += 1) {
          if (!onReveal(hit.event.event_id)) {
            await onLoadEarlier();
          } else {
            return;
          }
        }
      } finally {
        setSearchingEarlier(false);
      }
    },
    [onReveal, onLoadEarlier],
  );

  const step = useCallback(
    (delta: number) => {
      if (hits.length === 0) return;
      const next = (activeIndex + delta + hits.length) % hits.length;
      setActiveIndex(next);
      void reveal(hits[next]);
    },
    [activeIndex, hits, reveal],
  );

  // 结果集一变就跳到第一条：用户看到的应该是命中处，不是列表。
  const firstHit = hits[0];
  const jumpedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!firstHit || jumpedFor.current === `${debounced}:${firstHit.event.event_id}`) return;
    jumpedFor.current = `${debounced}:${firstHit.event.event_id}`;
    void reveal(firstHit);
  }, [firstHit, debounced, reveal]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // 上下键用来逐条跳，不用于移动光标——单行输入框里没有可移的行。
      event.preventDefault();
      step(event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  const total = result?.totalHits;
  const countLabel =
    hits.length === 0
      ? debounced.trim().length >= 2
        ? '无命中'
        : ''
      : `${activeIndex + 1}/${hits.length}${total && total > hits.length ? `·约${total}` : ''}`;

  return (
    <div
      role="search"
      aria-label="在房间中搜索"
      className="shrink-0 border-b border-border bg-card px-3 py-2 space-y-1.5"
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索房间消息内容，Enter 跳下一条"
            aria-label="搜索房间消息内容"
            className="h-8 pl-8 pr-2 text-sm"
          />
        </div>
        {search.isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
        {countLabel && <span className="text-xs tabular-nums text-muted-foreground shrink-0">{countLabel}</span>}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={() => step(-1)}
          disabled={hits.length === 0}
          aria-label="上一条命中"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={() => step(1)}
          disabled={hits.length === 0}
          aria-label="下一条命中"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={onClose} aria-label="关闭搜索">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {unsupported && (
        <p className="text-xs text-status-waiting">
          该服务端不支持内容检索{result?.reason ? `（${result.reason}）` : ''}，已退回只搜索已加载的消息。
        </p>
      )}
      {searchingEarlier && (
        <p className="text-xs text-muted-foreground">命中不在当前窗口，正在加载更早的消息…</p>
      )}
      {hits.length > 0 && (
        <ul className="max-h-56 overflow-y-auto space-y-0.5" aria-label="命中列表">
          {hits.slice(0, 50).map((hit) => (
            <HitRow
              key={hit.event.event_id}
              hit={hit}
              term={debounced}
              memberMap={memberMap}
              active={hit.event.event_id === hits[activeIndex]?.event.event_id}
              onSelect={() => {
                const idx = hits.findIndex((h) => h.event.event_id === hit.event.event_id);
                if (idx >= 0) setActiveIndex(idx);
                void reveal(hit);
              }}
            />
          ))}
        </ul>
      )}
      {hits.length === 0 && debounced.trim().length >= 2 && !search.isFetching && (
        <p className="text-xs text-muted-foreground">
          {unsupported ? '已加载的消息里没有这句话' : '这个房间里没有搜到这句话'}
        </p>
      )}
    </div>
  );
}
