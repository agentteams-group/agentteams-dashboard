import { describe, expect, it } from 'vitest';
import type { WorkflowResponse } from './agentteams-projects-api';
import type { HitlConfirmation } from './hitl-inbox';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';
import { assistantTaskNotes, attentionCounts, conversationTaskNotes, taskDuration } from './assistant-task-notes';

const room: RoomInfo = { id: '!leader:test', name: '设计团队助手', type: 'manager', agentRole: 'leader', members: [], parentTeam: 'design', team: { name: 'design', teamName: '设计团队' } as RoomInfo['team'] };
function workflow(overrides: Partial<WorkflowResponse> = {}): WorkflowResponse {
  return { project_id: 'project', title: '网站改版', status: 'active', team_id: 'design', source_room_id: '!project:test', nodes: [{ id: 'task', name: '首页设计', status: 'in-progress', assignee: 'designer' }], tasks_detail: [{ task_id: 'task', status: 'submitted', result_status: 'SUCCESS' }], edges: [], next: [], interrupts: [], ...overrides };
}

describe('assistant task notes', () => {
  it('times execution from task history and freezes the duration on submission', () => {
    const history = [
      { ts: '2026-11-14T10:00:00Z', to: 'assigned', action: 'delegate_task' },
      { ts: '2026-11-14T10:02:00Z', to: 'in_progress', action: 'ack_task' },
      { ts: '2026-11-14T10:35:00Z', to: 'submitted', action: 'submit_task' },
    ];
    const [item] = conversationTaskNotes(room, [workflow({ source_room_id: room.id, tasks_detail: [{ task_id: 'task', status: 'submitted', history }] })]);
    expect(taskDuration(item, Date.parse('2026-11-14T14:00:00Z'))).toBe('33 分钟');
    expect(taskDuration({ ...item, group: 'running', finishedAt: undefined }, Date.parse('2026-11-14T10:40:00Z'))).toBe('38 分钟');
    expect(taskDuration({ ...item, startedAt: undefined }, Date.now())).toBe('耗时待同步');
    expect(taskDuration({ ...item, group: 'pending', startedAt: undefined }, Date.now())).toBe('未开始');
  });
  it('scopes conversation tips to their origin instead of all tasks in the team or platform', () => {
    const ops = { ...room, agentRole: 'operations' as const };
    const own = workflow({ source_room_id: room.id, tasks_detail: [{ task_id: 'task', status: 'in_progress', room_id: '!execution:test' }] });
    const other = workflow({ project_id: 'other', source_room_id: '!other:test' });
    expect(conversationTaskNotes(ops, [own, other])).toEqual([
      expect.objectContaining({ projectId: 'project', group: 'running', roomId: '!execution:test' }),
    ]);
  });

  it('links a dedicated execution room back to the Matrix reply conversation', () => {
    const wf = workflow({ source_room_id: '!execution:test', reply_route: { channel: 'matrix', target_session: `room:${room.id}` }, tasks_detail: [{ task_id: 'task', status: 'submitted', room_id: '!execution:test' }] });
    expect(conversationTaskNotes(room, [wf])[0]).toMatchObject({ group: 'review', roomId: '!execution:test' });
    expect(conversationTaskNotes(room, [{ ...wf, reply_route: { channel: 'dingtalk', target_session: room.id } }])).toEqual([]);
  });

  it('matches task origins individually and does not use the origin conversation as execution room', () => {
    const wf = workflow({ source_room_id: '!other:test', tasks_detail: [
      { task_id: 'task', source_room_id: room.id, room_id: room.id },
      { task_id: 'unrelated', source_room_id: '!other:test', room_id: '!secret:test' },
    ] });
    expect(conversationTaskNotes(room, [wf])).toEqual([expect.objectContaining({ title: '首页设计', roomId: undefined })]);
  });

  it('counts attention per team using raw states without merging same-id tasks or approvals', () => {
    const other = { ...room, id: '!other:test', parentTeam: 'other', team: { name: 'other' } as RoomInfo['team'] };
    const workflows = [workflow(), workflow({ team_id: 'other', tasks_detail: [{ task_id: 'task', status: 'failed' }] })];
    expect(attentionCounts(assistantTaskNotes(room, [room, other], workflows, {}))).toEqual({ confirmation: 0, review: 1, failed: 0 });
    expect(attentionCounts(assistantTaskNotes(other, [room, other], workflows, {}))).toEqual({ confirmation: 0, review: 0, failed: 1 });
    const completed = workflow({ tasks_detail: [{ task_id: 'task', status: 'completed', result_status: 'SUCCESS' }] });
    expect(attentionCounts(assistantTaskNotes(room, [room], [completed], {})).review).toBe(0);
  });
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
