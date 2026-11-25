export interface ParsedAuditRef {
  roomId?: string;
  eventId?: string;
  confirmationId?: string;
  taskId?: string;
  replayId?: string;
}

/**
 * 从审计事件中提取与 Matrix 会话 / 回放相关的定位信息（D-2）。
 *
 * 审计日志来自两类源头：
 * 1. 治理与 HITL 审计（hitl.request, hitl.answer, hitl.expire 等）：
 *    entity_name 通常为 confirmationId，details JSON 中包含 room_id, confirmation_id。
 * 2. 状态放行审计（release.*）：
 *    entity_name 为 roomId 或 project_id，details JSON 中包含 task_id, eventType, stateKey 等。
 */
export function parseAuditRef(event: {
  entity_name?: string;
  details?: string;
}): ParsedAuditRef {
  let detailsObj: Record<string, unknown> = {};
  if (event.details) {
    try {
      detailsObj = JSON.parse(event.details) as Record<string, unknown>;
    } catch {
      // 容错非 JSON 纯文本 details
    }
  }

  const roomId =
    (typeof detailsObj.room_id === 'string' && detailsObj.room_id) ||
    (typeof detailsObj.roomId === 'string' && detailsObj.roomId) ||
    (event.entity_name?.startsWith('!') ? event.entity_name : undefined);

  const eventId =
    (typeof detailsObj.event_id === 'string' && detailsObj.event_id) ||
    (typeof detailsObj.eventId === 'string' && detailsObj.eventId) ||
    undefined;

  const confirmationId =
    (typeof detailsObj.confirmation_id === 'string' && detailsObj.confirmation_id) ||
    (event.entity_name?.startsWith('conf-') ? event.entity_name : undefined);

  const taskId =
    (typeof detailsObj.task_id === 'string' && detailsObj.task_id) ||
    (typeof detailsObj.taskId === 'string' && detailsObj.taskId) ||
    undefined;

  const replayId =
    (typeof detailsObj.replay_id === 'string' && detailsObj.replay_id) ||
    (typeof detailsObj.replayId === 'string' && detailsObj.replayId) ||
    undefined;

  return { roomId, eventId, confirmationId, taskId, replayId };
}
