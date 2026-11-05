import { describe, expect, it } from 'vitest';
import { preferredAgentRoom } from './agent-conversations';
import type { RoomInfo } from './room-info';

const ops: RoomInfo = { id: '!ops:test', name: '平台助手', type: 'manager', members: [], agentRole: 'operations' };
const leader: RoomInfo = { id: '!leader:test', name: '设计团队助手', type: 'manager', members: [], agentRole: 'leader', parentTeam: 'design' };
const group: RoomInfo = { id: '!group:test', name: '设计团队', type: 'team', members: [] };

describe('preferredAgentRoom', () => {
  it('lands admins in the operations conversation regardless of recent team activity', () => {
    expect(preferredAgentRoom([leader, group, ops], 3)?.id).toBe(ops.id);
  });

  it('lands team members in their leader DM and never falls back to an admin conversation', () => {
    expect(preferredAgentRoom([ops, group, leader], 2)?.id).toBe(leader.id);
    expect(preferredAgentRoom([ops, group], 2)).toBeUndefined();
  });

  it('does not mistake group or worker rooms for an assistant', () => {
    expect(preferredAgentRoom([group], 3)).toBeUndefined();
    expect(preferredAgentRoom([], 1)).toBeUndefined();
  });
});
