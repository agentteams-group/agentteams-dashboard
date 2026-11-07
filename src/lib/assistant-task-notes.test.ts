import { describe, expect, it } from 'vitest';
import type { WorkflowResponse } from './agentteams-projects-api';
import type { HitlConfirmation } from './hitl-inbox';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';
import { assistantTaskNotes } from './assistant-task-notes';

const room: RoomInfo = { id: '!leader:test', name: '设计团队助手', type: 'manager', agentRole: 'leader', members: [], parentTeam: 'design', team: { name: 'design', teamName: '设计团队' } as RoomInfo['team'] };
function workflow(overrides: Partial<WorkflowResponse> = {}): WorkflowResponse {
  return { project_id: 'project', title: '网站改版', status: 'active', team_id: 'design', source_room_id: '!project:test', nodes: [{ id: 'task', name: '首页设计', status: 'in-progress', assignee: 'designer' }], tasks_detail: [{ task_id: 'task', status: 'submitted', result_status: 'SUCCESS' }], edges: [], next: [], interrupts: [], ...overrides };
}

describe('assistant task notes', () => {
  it('uses raw submitted state as awaiting acceptance despite a successful result and normalized running node', () => {
    const [item] = assistantTaskNotes(room, [room], [workflow()], {});
    expect(item).toMatchObject({ group: 'review', title: '首页设计', assignee: 'designer', projectId: 'project', teamId: 'design' });
  });

  it.each([['failed', 'failed'], ['completed', 'completed'], ['revision', 'revision'], ['blocked', 'blocked'], ['cancelled', 'cancelled'], ['assigned', 'running']])('keeps %s distinct', (status, group) => {
    const [item] = assistantTaskNotes(room, [room], [workflow({ tasks_detail: [{ task_id: 'task', status }] })], {});
    expect(item.group).toBe(group);
  });

  it('does not infer acceptance pending from a completed node when raw detail is unavailable', () => {
    const [item] = assistantTaskNotes(room, [room], [workflow({ nodes: [{ id: 'task', name: '首页设计', status: 'completed' }], tasks_detail: undefined })], {});
    expect(item.group).toBe('completed');
  });

  it('includes confirmations from the team project room and excludes unrelated teams and saved approvals', () => {
    const confirmation = (id: string, roomId: string): HitlConfirmation => ({ id, roomId, eventId: id, sender: '@leader:test', toolName: 'deploy', approveReply: 'yes', rejectReply: 'no', timestamp: 1 });
    const items = assistantTaskNotes(room, [room], [workflow(), workflow({ project_id: 'secret', team_id: 'other', source_room_id: '!other:test' })], { own: confirmation('own', '!project:test'), other: confirmation('other', '!other:test') });
    expect(items.filter(item => item.group === 'confirmation').map(item => item.confirmationId)).toEqual(['own']);
    expect(items.filter(item => item.projectId === 'secret')).toHaveLength(0);
  });

  it('preserves team identity for duplicate project and task ids', () => {
    const ops = { ...room, agentRole: 'operations' as const };
    const items = assistantTaskNotes(ops, [ops], [workflow(), workflow({ team_id: 'other' })], {});
    expect(items).toHaveLength(2);
    expect(new Set(items.map(item => item.id)).size).toBe(2);
  });

  it('surfaces project interrupts without automatically approving them', () => {
    const items = assistantTaskNotes(room, [room], [workflow({ interrupts: [{ id: 'pause', value: '确认发布窗口', description: '等待你的决定' }] })], {});
    expect(items.find(item => item.group === 'confirmation')).toMatchObject({ title: '等待你的决定', projectId: 'project' });
  });
});
