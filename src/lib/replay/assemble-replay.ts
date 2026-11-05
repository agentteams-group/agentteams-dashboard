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
  //    （f3-4：与在线渲染一致——ChatSection.tsx 只对 workers 建 map；人类
  //    sender 不进 map → stampOwners 不盖 workerName → turnBlocksOf 的
  //    !message.workerName 门使其保持独立气泡，也不会被 chooseAnswer 选为
  //    回合答案）。
  //    局限：回放包不含 worker 注册表，此处只能用子串启发式（sender 含
  //    worker/agent/bot）判定，可能误判（如人名恰好含 'bot'）；根治需在
  //    导出时把 worker 清单写入回放包（设计改动，不在本轮）。
  const runtimeMap: Record<string, { runtime: string; workerName: string }> = {};
  for (const ev of sorted) {
    const isAgent =
      ev.sender.includes('worker') || ev.sender.includes('agent') || ev.sender.includes('bot');
    if (!isAgent) continue;
    if (!runtimeMap[ev.sender]) {
      runtimeMap[ev.sender] = {
        runtime: 'qwenpaw',
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
