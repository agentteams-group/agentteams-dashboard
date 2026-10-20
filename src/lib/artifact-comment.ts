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

export interface ArtifactComment {
  /** 工件标识（文件名/路径）。 */
  artifact: string;
  /** 行锚点（文本工件；缺省 = 整文件）。 */
  line?: number;
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
    comments.push({
      artifact,
      ...(typeof m.line === 'number' ? { line: m.line } : {}),
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
  action?: 'comment' | 'resolve';
  resolvesTs?: number;
}

/** 发送评论（正文进时间线，元数据进自定义 content key）。 */
export async function sendArtifactComment(input: SendArtifactCommentInput): Promise<void> {
  const meta: Record<string, unknown> = {
    artifact: input.artifact,
    author: input.author,
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.action === 'resolve' ? { action: 'resolve', resolves_ts: input.resolvesTs } : {}),
  };
  const prefix = input.line !== undefined ? `L${input.line} ` : '';
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(input.roomId)}/send`, {
    method: 'PUT',
    body: JSON.stringify({
      msgtype: 'm.text',
      body:
        input.action === 'resolve'
          ? `[工件评论] 已解决：${input.artifact}（${prefix.trim()}）`
          : `[工件评论] ${prefix}${input.artifact}: ${input.body}`,
      'com.agentteams.artifact_comment': meta,
    }),
  });
  if (!res.ok) throw new Error(`评论发送失败（${res.status}）`);
}

/** 发送普通文本消息（F6.3 批量派发的降级通道）。 */
export async function sendRoomText(roomId: string, body: string): Promise<void> {
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(roomId)}/send`, {
    method: 'PUT',
    body: JSON.stringify({ msgtype: 'm.text', body }),
  });
  if (!res.ok) throw new Error(`消息发送失败（${res.status}）`);
}
