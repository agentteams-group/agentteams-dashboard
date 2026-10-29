import type { MatrixEvent } from '@/lib/matrix-api';
import { formatMatrixEvents, type DisplayMessage } from '@/hooks/use-matrix';
import { assembleChatTimeline } from '@/lib/chat-ir/assemble';
import {
  parseReplayJsonl,
  reconstructMatrixEvent,
  type ExportedJsonlRecord,
} from './parse-replay';

export { parseReplayJsonl, reconstructMatrixEvent, type ExportedJsonlRecord };

/**
 * 装配 Replay 时间线：
 * 1. 调用 formatMatrixEvents 进行基础格式化与编辑合并；
 * 2. 调用 assembleChatTimeline 解析 A2UI 块、思考/工具调用折叠以及接力卡；
 * 3. 返回只读展示用的 DisplayMessage[]。
 */
export function assembleReplayTimeline(events: MatrixEvent[]): DisplayMessage[] {
  if (events.length === 0) return [];

  // 按时间升序排序，确保装配顺序正确
  const sorted = [...events].sort((a, b) => a.origin_server_ts - b.origin_server_ts);

  // 只读回放统一视角的当前用户
  const currentUserId = '@replay-viewer:agentteams.local';

  // 1. 基础事件转换
  const rawMessages = formatMatrixEvents(sorted, currentUserId);

  // 2. 识别所有 worker sender，构建 runtimeMap 使得思考/工具调用能够正确折叠
  const runtimeMap: Record<string, { runtime: string; workerName: string }> = {};
  for (const ev of sorted) {
    if (ev.sender && !runtimeMap[ev.sender]) {
      const isAgent = ev.sender.includes('worker') || ev.sender.includes('agent') || ev.sender.includes('bot');
      runtimeMap[ev.sender] = {
        runtime: isAgent ? 'qwenpaw' : 'human',
        workerName: ev.sender.split(':')[0]?.replace('@', '') ?? ev.sender,
      };
    }
  }

  // 3. 执行 ChatIR 汇聚与折叠装配
  const { messages } = assembleChatTimeline(rawMessages, sorted, {
    currentUserId,
    runtimeMap,
    now: sorted[sorted.length - 1]?.origin_server_ts ?? Date.now(),
  });

  return messages;
}
