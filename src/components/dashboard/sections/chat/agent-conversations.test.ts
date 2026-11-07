import { describe, expect, it } from 'vitest';
import { preferredAgentRoom, withLeaderAccess, conversationSections, conversationStorageKey } from './agent-conversations';
import type { RoomInfo } from './room-info';

const ops: RoomInfo = { id: '!ops:test', name: '平台助手', type: 'manager', members: [], agentRole: 'operations' };
const leader: RoomInfo = { id: '!leader:test', name: '设计团队助手', type: 'manager', members: [], agentRole: 'leader', parentTeam: 'design', access: 'joined' };
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

  it('restores an accessible selection but ignores removed or forbidden rooms', () => {
    expect(preferredAgentRoom([ops, leader], 3, leader.id)?.id).toBe(leader.id);
    expect(preferredAgentRoom([ops, { ...leader, access: 'not-joined' }], 3, leader.id)?.id).toBe(ops.id);
    expect(preferredAgentRoom([ops, leader], 2, ops.id)?.id).toBe(leader.id);
    expect(preferredAgentRoom([ops, leader], 3, '!deleted:test')?.id).toBe(ops.id);
  });

  it('chooses a stable team instead of following new messages', () => {
    const another = { ...leader, id: '!a:test', parentTeam: 'alpha', name: 'Alpha助手' };
    expect(preferredAgentRoom([leader, another], 2)?.id).toBe(another.id);
    expect(preferredAgentRoom([another, leader], 2)?.id).toBe(another.id);
  });

  it('requires confirmed membership for a Leader DM and retains other room entrances', () => {
    const rooms = [ops, leader, group];
    expect(withLeaderAccess(rooms, undefined, 'checking')[1].access).toBe('checking');
    expect(withLeaderAccess(rooms, [], 'joined')[1].access).toBe('not-joined');
    expect(withLeaderAccess(rooms, [leader.id], 'joined')[1].access).toBe('joined');
    expect(withLeaderAccess(rooms, [leader.id], 'error')[1].access).toBe('error');
    expect(preferredAgentRoom(withLeaderAccess(rooms, [], 'joined'), 2)).toBeUndefined();
    expect(withLeaderAccess(rooms, [], 'joined').map(room => room.id)).toEqual(rooms.map(room => room.id));
  });

  it('groups each team separately while retaining ordinary and sync-only conversations', () => {
    const teamGroup = { ...group, parentTeam: 'design' };
    const worker: RoomInfo = { id: '!worker:test', name: 'Worker', type: 'worker', members: [], parentTeam: 'design' };
    const other: RoomInfo = { id: '!project:test', name: '项目群', type: 'unknown', members: [] };
    const sections = conversationSections([worker, leader, ops, other, teamGroup]);
    expect(sections.operations.map(room => room.id)).toEqual([ops.id]);
    expect(sections.teams[0].rooms.map(room => room.id)).toEqual([leader.id, group.id]);
    expect(sections.other.map(room => room.id)).toEqual([worker.id, other.id]);
  });

  it('separates remembered selections by account and homeserver without credentials', () => {
    expect(conversationStorageKey('https://one', '@a:one')).not.toBe(conversationStorageKey('https://one', '@b:one'));
    expect(conversationStorageKey('https://one', '@a:one')).not.toBe(conversationStorageKey('https://two', '@a:one'));
    expect(conversationStorageKey('https://one', '')).toBeNull();
  });
});
