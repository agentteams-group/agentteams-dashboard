import type { MentionEntry } from './chat-composer';

export interface ConfirmationReply {
  content: string;
  mentions?: MentionEntry[];
}

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
