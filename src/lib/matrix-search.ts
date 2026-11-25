import type { MatrixEvent } from '@/lib/matrix-api';

/**
 * 房间内容检索（方案 v3 B-1）的纯逻辑层。
 *
 * 为什么单独成文件：Matrix 的 `/rooms/{id}/messages?filter=` 走的是 RoomEventFilter，
 * 只能按 type / sender / limit 筛，**不支持文本匹配**——早期方案里写的「messages 加
 * filter 参数」做不出「搜到上周那条消息」。全文检索只有 `/_matrix/client/v3/search`
 * 一条路，而 Synapse 的搜索索引可被运营者关掉（`search_indexing_enabled`），关掉后
 * 返回错误码而不是空结果。所以这里同时负责：构造 filter、解析两种历史响应形状、
 * 判定「服务端不支持检索」并退回本地已加载消息的匹配。
 */

/** 单条命中：事件本体 + 服务端给的相关度（本地降级结果没有 rank）。 */
export interface RoomSearchHit {
  event: MatrixEvent;
  rank?: number;
}

/** 一次检索的结果；`nextBatch` 为空表示没有更多分页。 */
export interface RoomSearchResult {
  hits: RoomSearchHit[];
  nextBatch?: string;
  /** 服务端报告的总命中数，用于「3/17」计数；拿不到时为 undefined。 */
  totalHits?: number;
  /** true = 这个 homeserver 没有可用的全文检索，调用方应显示降级提示。 */
  unsupported: boolean;
  /** 降级原因文案（服务端返回的 error 字段），仅 unsupported 时有值。 */
  reason?: string;
}

const SEARCHABLE_TYPES = ['m.room.message'];

/**
 * 构造 `search` 的 filter JSON 字符串。
 *
 * 同时写两份是刻意的：`category` + `filter` 是 Client-Server 早期形状（Synapse 一直
 * 在收），`room_events` 是 1.2 之后搜索 API 推荐的形状；只写一份会在另一类服务端上
 * 退化成「全库搜」。房间范围靠 `filter.rooms`，RoomEventFilter 认这个字段。
 *
 * @param roomId 具体房间；传 null = 不限房间（跨房间检索，命令面板的 `message` 实体用）。
 */
export function buildRoomSearchFilter(roomId: string | null, term: string, limit = 50): string {
  const clamped = Math.max(1, Math.min(100, Math.floor(limit)));
  // 不限房间时不能拼 `rooms: []`：空数组在 Synapse 上是「不匹配任何房间」，而不是「无限制」。
  const roomScope = roomId ? { rooms: [roomId] } : {};
  return JSON.stringify({
    search_terms: [term],
    category: 'room',
    filter: {
      ...roomScope,
      types: SEARCHABLE_TYPES,
      limit: clamped,
    },
    order_by: 'recent',
    room_events: {
      limit: clamped,
      order_by: 'recent',
      types: SEARCHABLE_TYPES,
      filter: roomScope,
    },
  });
}

/** 服务端错误码里表示「检索能力不可用」的那些——不是没搜到，是搜不了。 */
const UNSUPPORTED_ERRCODES = new Set([
  'M_SEARCH_DISABLED',
  'M_UNRECOGNIZED',
  'M_INVALID_PARAM',
  'M_UNKNOWN',
]);

function errcodeOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const code = (body as { errcode?: unknown }).errcode;
  return typeof code === 'string' ? code : undefined;
}

/** 上游 `error` 文案（如 Synapse 的 "Searching is not enabled"），降级提示直接引它。 */
export function searchErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const text = (body as { error?: unknown }).error;
  return typeof text === 'string' ? text : undefined;
}

/**
 * 判定这次失败是「服务端不支持内容检索」而非「没搜到」或「凭据/网络问题」。
 * 404 = 路由不存在（非 Synapse 的实现或被网关屏蔽）；400/405 带上述错误码时同样算。
 * 401/403/5xx 不算 unsupported：那是登录或上游故障，要照常报错，不能伪装成降级。
 */
export function detectSearchUnsupported(status: number, body: unknown): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 405) return false;
  const code = errcodeOf(body);
  return code === undefined ? true : UNSUPPORTED_ERRCODES.has(code);
}

interface RawSearchHit {
  event?: MatrixEvent;
  rank?: number;
}

function toHits(raw: unknown): RoomSearchHit[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomSearchHit[] = [];
  for (const item of raw as RawSearchHit[]) {
    // 没有 event_id 的条目不能用来定位气泡，直接丢弃而不是渲染成空行。
    if (!item?.event?.event_id) continue;
    out.push({ event: item.event, rank: typeof item.rank === 'number' ? item.rank : undefined });
  }
  return out;
}

/**
 * 解析 `/search` 响应。两种形状都吃：
 * - 早期：`results.results`
 * - 1.2+：`results.room_events.results`
 * 拿不到数组时按空结果处理，但 `unsupported` 留给调用方按 HTTP 状态判定。
 */
export function parseRoomSearchResponse(body: unknown): RoomSearchResult {
  const results = (body as { results?: Record<string, unknown> } | null)?.results;
  if (!results || typeof results !== 'object') {
    return { hits: [], unsupported: false };
  }

  const scoped = results.room_events as
    | { results?: unknown; next_batch?: unknown; hits?: unknown }
    | undefined;
  const legacy = results as { results?: unknown; next_batch?: unknown };

  const hits = toHits(scoped?.results ?? legacy.results);
  const nextBatch = scoped?.next_batch ?? legacy.next_batch;
  const hitsTotal = scoped?.hits;

  return {
    hits,
    nextBatch: typeof nextBatch === 'string' && nextBatch ? nextBatch : undefined,
    totalHits: typeof hitsTotal === 'number' ? hitsTotal : undefined,
    unsupported: false,
  };
}

/** 组装带检索参数的代理路径；只白名单 `filter` 与 `next_batch` 两个上游参数。 */
export function buildSearchProxyPath(filter: string, nextBatch?: string): string {
  const params = new URLSearchParams({ filter });
  if (nextBatch) params.set('next_batch', nextBatch);
  return `/_matrix/client/v3/search?${params.toString()}`;
}

/**
 * 取一条消息的纯文本正文，用于搜索结果的片段与本地降级匹配。
 * `formatted_body` 是 HTML，拿来做子串匹配会把标签也算进去，所以只取 `body`。
 */
export function searchableBody(event: MatrixEvent): string {
  const content = event.content ?? {};
  if (typeof content.body === 'string') return content.body;
  if (typeof content.msgtype === 'string' && content.msgtype !== 'm.text') return '';
  return '';
}

/**
 * 本地降级检索：服务端没有全文索引时，在当前会话已加载的消息里找。
 * 覆盖范围只有已加载窗口，所以调用方必须同时标注「仅搜索已加载消息」。
 */
export function searchInLoadedMessages(events: MatrixEvent[], term: string): RoomSearchHit[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const out: RoomSearchHit[] = [];
  for (const event of events) {
    if (event.type !== 'm.room.message') continue;
    if (searchableBody(event).toLowerCase().includes(needle)) out.push({ event });
  }
  return out;
}

/**
 * 命中片段：以第一个命中词为中心截一段，前后各留 padding 让上下文可读。
 * 返回 [前缀, 命中, 后缀]，UI 侧只给中间那段套 <mark>，避免在渲染层再解析一次字符串。
 */
export function highlightSnippet(
  text: string,
  term: string,
  radius = 28,
): { before: string; match: string; after: string } | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, at),
    match: text.slice(at, at + needle.length),
    after: text.slice(at + needle.length, end) + (end < text.length ? '…' : ''),
  };
}
