import { describe, expect, it } from 'vitest';
import { parseAuditRef } from './audit-ref';

describe('parseAuditRef: 审计与回放定位信息解析 (D-2)', () => {
  it('从 HITL 审计事件中提取 roomId、confirmationId 及工具名参数', () => {
    const event = {
      entity_name: 'conf-hitl-001',
      details: JSON.stringify({
        confirmation_id: 'conf-hitl-001',
        room_id: '!room_abc:local',
        tool_name: 'deploy_service',
        answer: 'approve',
      }),
    };

    const ref = parseAuditRef(event);
    expect(ref.roomId).toBe('!room_abc:local');
    expect(ref.confirmationId).toBe('conf-hitl-001');
  });

  it('从放行/状态审计事件中提取 roomId 和 taskId', () => {
    const event = {
      entity_name: '!room_task_88:server',
      details: JSON.stringify({
        task_id: 'task-release-09',
        eventType: 'com.agentteams.release',
      }),
    };

    const ref = parseAuditRef(event);
    expect(ref.roomId).toBe('!room_task_88:server');
    expect(ref.taskId).toBe('task-release-09');
  });

  it('从带 replayId 和 eventId 的事件中解析完整定位信息', () => {
    const event = {
      entity_name: 'system',
      details: JSON.stringify({
        replay_id: 'e2e00000000000000000000000000001',
        event_id: '$event_999',
      }),
    };

    const ref = parseAuditRef(event);
    expect(ref.replayId).toBe('e2e00000000000000000000000000001');
    expect(ref.eventId).toBe('$event_999');
  });

  it('非 JSON 字符串 details 优雅降级不报错', () => {
    const event = {
      entity_name: '!room_fallback:local',
      details: 'plain text details without json',
    };

    const ref = parseAuditRef(event);
    expect(ref.roomId).toBe('!room_fallback:local');
    expect(ref.eventId).toBeUndefined();
  });
});
