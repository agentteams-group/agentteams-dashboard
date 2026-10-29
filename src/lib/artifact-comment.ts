/**
 * Artifact anchored comments over Matrix messages (PRD F6.2/F6.3).
 *
 * 评论以 m.room.message 承载（正文进房间时间线 = 成果沉淀对话流），
 * 锚点元数据放自定义 content key `com.agentteams.artifact_comment`
 * （Stateless 安全：零服务端存储域）。解决状态以一条 action=resolve 的
 * 追加事件表达（历史可回溯，不覆盖原评论）。批量派发（F6.3，G2 降级）
 * 生成结构化指令消息发回房间由 Manager 消费。
 */

import { matrixProxyFetch } from './matrix-write';

export const ARTIFACT_COMMENT_CONTENT_KEY = 'com.agentteams.artifact_comment';

/** 批量派发的结构化内容 key（E-2）：Manager 可据此建任务，未接契约时正文仍可读。 */
export const COMMENT_DISPATCH_CONTENT_KEY = 'com.agentteams.comment_dispatch';

/** 图片锚点：相对坐标（0–1，左上为原点），与展示尺寸无关。 */
export interface ArtifactCoordinate {
  x: number;
  y: number;
}

export interface ArtifactComment {
  /** 工件标识（文件名/路径）。 */
  artifact: string;
  /** 行锚点（文本工件；缺省 = 整文件）。 */
  line?: number;
  /** 坐标锚点（图片工件）。 */
  coordinate?: ArtifactCoordinate;
  body: string;
  author: string;
  ts: number;
  /** 追加事件类型：缺省 = 评论本体；resolve = 标记解决。 */
  action?: 'comment' | 'resolve';
  /** resolve 事件指向的原评论时间戳。 */
  resolvesTs?: number;
}

interface MatrixChunkEvent {
  type?: unknown;
  content?: Record<string, unknown>;
  origin_server_ts?: unknown;
  sender?: unknown;
  event_id?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 从 /messages 响应 chunk 提取工件评论（按时间升序，畸形剔除）。 */
export function parseArtifactComments(chunk: unknown): ArtifactComment[] {
  if (!chunk || typeof chunk !== 'object' || !Array.isArray((chunk as { chunk?: unknown }).chunk)) {
    return [];
  }
  const events = (chunk as { chunk: unknown[] }).chunk;
  const comments: ArtifactComment[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as MatrixChunkEvent;
    if (event.type !== 'm.room.message') continue;
    const meta = event.content?.[ARTIFACT_COMMENT_CONTENT_KEY];
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
    const m = meta as Record<string, unknown>;
    const artifact = asString(m.artifact);
    const author = asString(m.author) ?? asString(event.sender);
    const body = asString(event.content?.body) ?? asString(m.body);
    const ts = typeof event.origin_server_ts === 'number' ? event.origin_server_ts : undefined;
    if (!artifact || !author || ts === undefined) continue;
    const action = m.action === 'resolve' ? 'resolve' : 'comment';
    const coordinate = parseCoordinate(m.coordinate);
    comments.push({
      artifact,
      ...(typeof m.line === 'number' ? { line: m.line } : {}),
      ...(coordinate ? { coordinate } : {}),
      body: body ?? '',
      author,
      ts,
      action,
      ...(typeof m.resolves_ts === 'number' ? { resolvesTs: m.resolves_ts } : {}),
    });
  }
  return comments.sort((a, b) => a.ts - b.ts);
}

/** 评论列表 → 展示态：本体 + 解决状态回溯（resolve 事件按 resolves_ts 归并）。 */
export function resolveCommentThreads(
  comments: ArtifactComment[]
): Array<ArtifactComment & { resolvedBy?: string; resolvedAt?: number }> {
  const resolvesByTs = new Map<number, ArtifactComment>();
  for (const c of comments) {
    if (c.action === 'resolve' && c.resolvesTs !== undefined) {
      resolvesByTs.set(c.resolvesTs, c);
    }
  }
  return comments
    .filter((c) => c.action === 'comment')
    .map((c) => {
      const resolution = resolvesByTs.get(c.ts);
      return resolution
        ? { ...c, resolvedBy: resolution.author, resolvedAt: resolution.ts }
        : c;
    });
}

interface SendArtifactCommentInput {
  roomId: string;
  artifact: string;
  body: string;
  author: string;
  line?: number;
  /** 图片坐标锚点（E-1）：相对坐标 0–1。 */
  coordinate?: ArtifactCoordinate;
  action?: 'comment' | 'resolve';
  resolvesTs?: number;
}

/** 坐标必须是 0–1 之间的有限数；越界/脏值直接丢弃，不编一个假锚点。 */
function parseCoordinate(raw: unknown): ArtifactCoordinate | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  const x = typeof c.x === 'number' ? c.x : NaN;
  const y = typeof c.y === 'number' ? c.y : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  return { x, y };
}

/** 锚点可读标签：行 / 坐标 / 全文（列表徽标与派单正文共用）。 */
export function commentAnchorLabel(
  comment: Pick<ArtifactComment, 'line' | 'coordinate'>,
): string {
  if (comment.line !== undefined) return `L${comment.line}`;
  if (comment.coordinate) {
    return `(${Math.round(comment.coordinate.x * 100)}%, ${Math.round(comment.coordinate.y * 100)}%)`;
  }
  return '全文';
}

/**
 * 工件侧聚合（E-1）：把整房间的评论按工件分组并归并解决状态，
 * 工件详情只取自己那一组即可，不在渲染层重复过滤。
 */
export function groupCommentsByArtifact(
  comments: ArtifactComment[],
): Map<string, Array<ArtifactComment & { resolvedBy?: string; resolvedAt?: number }>> {
  const grouped = new Map<string, ArtifactComment[]>();
  for (const comment of comments) {
    const list = grouped.get(comment.artifact) ?? [];
    list.push(comment);
    grouped.set(comment.artifact, list);
  }
  const out = new Map<string, Array<ArtifactComment & { resolvedBy?: string; resolvedAt?: number }>>();
  for (const [artifact, list] of grouped) {
    out.set(artifact, resolveCommentThreads(list));
  }
  return out;
}

/** 发送评论（正文进时间线，元数据进自定义 content key）。 */
export async function sendArtifactComment(input: SendArtifactCommentInput): Promise<void> {
  const coordinate = input.coordinate ? parseCoordinate(input.coordinate) : undefined;
  const meta: Record<string, unknown> = {
    artifact: input.artifact,
    author: input.author,
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(coordinate ? { coordinate } : {}),
    ...(input.action === 'resolve' ? { action: 'resolve', resolves_ts: input.resolvesTs } : {}),
  };
  const anchorText =
    input.line !== undefined
      ? `L${input.line} `
      : coordinate
        ? `(${Math.round(coordinate.x * 100)}%, ${Math.round(coordinate.y * 100)}%) `
        : '';
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(input.roomId)}/send`, {
    method: 'PUT',
    body: JSON.stringify({
      msgtype: 'm.text',
      body:
        input.action === 'resolve'
          ? `[工件评论] 已解决：${input.artifact}（${anchorText.trim()}）`
          : `[工件评论] ${anchorText}${input.artifact}: ${input.body}`,
      'com.agentteams.artifact_comment': meta,
    }),
  });
  if (!res.ok) throw new Error(`评论发送失败（${res.status}）`);
}

export interface CommentDispatchPayload {
  assignee: string;
  artifact: string;
  dispatchedBy: string;
  comments: Array<{
    ts: number;
    body: string;
    author: string;
    line?: number;
    coordinate?: ArtifactCoordinate;
  }>;
}

/**
 * 批量派发（E-2 / PRD F6.3，G2 降级）：正文是 Manager 能直接读懂的结构化指令，
 * 同时带 `com.agentteams.comment_dispatch` 结构化载荷（无上游建任务契约时，
 * 消费端仍可按字段解析；人读的正文永远不会丢）。
 */
export async function sendCommentDispatch(input: {
  roomId: string;
  artifact: string;
  assignee: string;
  comments: ArtifactComment[];
  dispatchedBy: string;
}): Promise<void> {
  const assignee = input.assignee.trim();
  if (!assignee) throw new Error('指派对象不能为空');
  if (input.comments.length === 0) throw new Error('请至少选择一条评论');
  const payload: CommentDispatchPayload = {
    assignee,
    artifact: input.artifact,
    dispatchedBy: input.dispatchedBy,
    comments: input.comments.map((comment) => ({
      ts: comment.ts,
      body: comment.body,
      author: comment.author,
      ...(comment.line !== undefined ? { line: comment.line } : {}),
      ...(comment.coordinate ? { coordinate: comment.coordinate } : {}),
    })),
  };
  const lines = input.comments.map(
    (comment, index) => `${index + 1}. [${commentAnchorLabel(comment)}] ${comment.body}（评论人 ${comment.author}）`,
  );
  const body = [
    `【修复派单 · 工件评论】@${assignee}`,
    `请处理工件 ${input.artifact} 的 ${input.comments.length} 条评论：`,
    '',
    ...lines,
  ].join('\n');
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(input.roomId)}/send`, {
    method: 'PUT',
    body: JSON.stringify({
      msgtype: 'm.text',
      body,
      [COMMENT_DISPATCH_CONTENT_KEY]: payload,
    }),
  });
  if (!res.ok) throw new Error(`派发发送失败（${res.status}）`);
}

/** 发送普通文本消息（F6.3 批量派发的降级通道）。 */
export async function sendRoomText(roomId: string, body: string): Promise<void> {
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(roomId)}/send`, {
    method: 'PUT',
    body: JSON.stringify({ msgtype: 'm.text', body }),
  });
  if (!res.ok) throw new Error(`消息发送失败（${res.status}）`);
}
