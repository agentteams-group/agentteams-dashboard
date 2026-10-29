import type { MentionEntry } from './chat-composer';

export interface ConfirmationReply {
  content: string;
  mentions?: MentionEntry[];
}

/**
 * 卡片答复的结构化回写字段（方案 v3 C-3）。
 *
 * 与 `file_refs` 走同一条 Matrix 自定义 content 字段通道（`sendOutbound` 的
 * `extra`），运行时消费端可以按 `confirmation_id` 精确关联回那张卡片，
 * 不再依赖「答案被压成一句自然语言」这种无法追踪的形式。
 */
export const ANSWER_CONTENT_KEY = 'com.agentteams.answer';

export interface ConfirmationAnswerField {
  /** 卡片自身的确认 id；启发式卡（`heuristic:` 前缀）不是运行时请求，不带此字段。 */
  confirmation_id: string;
  /** 与房间正文一致的所见答案，便于消费端不必再解析自然语言。 */
  answer: string;
  /** 提交人的 Matrix 用户 id。 */
  actor?: string;
  tool_name?: string;
}

/**
 * 组装回写字段；返回的是可以直接并进 `sendOutbound` 的 `extra` 的对象。
 * 空 confirmation_id 时返回 `undefined`：宁可不带字段，也不要写一个对不上号的 id。
 */
export function buildAnswerContent(
  answer: ConfirmationAnswerField | undefined,
): Record<string, ConfirmationAnswerField> | undefined {
  if (!answer || !answer.confirmation_id.trim()) return undefined;
  return { [ANSWER_CONTENT_KEY]: answer };
}

/**
 * 卡片答复的发送结果。`true` 才等于「这条答复进了房间」；`false`/`undefined`
 * 都是未写入，卡片不得据此翻成已答复（方案 v3 C-3 的诚实性要求）。
 * 保留 `void` 分支是因为既有调用点（话题面板、测试桩）本来就不回报结果。
 */
export type AnswerSendResult = boolean | void | Promise<boolean> | Promise<void>;

/**
 * 卡片选择提交后的回写内容。
 *
 * Worker / team 房间里的 Agent 只响应带 @ 的消息；Manager 房间不要求 @。
 * 房间是否非 Manager 由 workerMatrixUserIds 决定（Manager/Human 房间为空）。
 * 优先 @ 发起卡片的 Agent，拿不到发送者时退回房间的第一个 Worker。
 */
export function buildConfirmationReply(
  content: string,
  sender: string | undefined,
  workerMatrixUserIds: string[] | undefined,
): ConfirmationReply {
  const workerIds = workerMatrixUserIds ?? [];
  if (workerIds.length === 0) return { content };

  const targetId = sender && workerIds.includes(sender) ? sender : workerIds[0];
  const name = targetId.startsWith('@')
    ? targetId.slice(1).split(':')[0]
    : targetId.split(':')[0];
  const mention: MentionEntry = {
    userId: targetId,
    displayName: name,
    placeholder: `@${name}`,
  };

  return {
    content: `${mention.placeholder} ${content}`,
    mentions: [mention],
  };
}
