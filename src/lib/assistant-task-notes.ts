import type { WorkflowResponse } from './agentteams-projects-api';
import type { HitlConfirmation } from './hitl-inbox';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';

export const TASK_NOTE_GROUPS = [
  { id: 'confirmation', label: '待人工确认', attention: true },
  { id: 'review', label: '待验收', attention: true },
  { id: 'failed', label: '失败', attention: true },
  { id: 'blocked', label: '阻塞', attention: true },
  { id: 'revision', label: '需修订', attention: true },
  { id: 'running', label: '已分配 / 进行中', attention: false },
  { id: 'pending', label: '待分配', attention: false },
  { id: 'completed', label: '已完成', attention: false },
  { id: 'cancelled', label: '已取消', attention: false },
  { id: 'unknown', label: '状态待同步', attention: false },
] as const;

export interface AssistantTaskNoteItem {
  id: string;
  group: typeof TASK_NOTE_GROUPS[number]['id'];
  title: string;
  projectId?: string;
  projectTitle?: string;
  teamId?: string;
  assignee?: string;
  roomId?: string;
  confirmationId?: string;
}

function taskGroup(status?: string): AssistantTaskNoteItem['group'] {
  switch (status) {
    case 'submitted': return 'review';
    case 'failed': case 'error': return 'failed';
    case 'blocked': return 'blocked';
    case 'revision': return 'revision';
    case 'assigned': case 'delegated': case 'in-progress': case 'in_progress': case 'running': return 'running';
    case 'planned': case 'pending': return 'pending';
    case 'completed': return 'completed';
    case 'cancelled': case 'canceled': return 'cancelled';
    default: return 'unknown';
  }
}

/** Keep raw task detail: normalized workflow nodes fold submitted into running. */
export function assistantTaskNotes(
  room: RoomInfo,
  rooms: RoomInfo[],
  workflows: WorkflowResponse[],
  confirmations: Record<string, HitlConfirmation>,
): AssistantTaskNoteItem[] {
  const teamIds = new Set([room.parentTeam, room.team?.name, room.team?.teamName].filter(Boolean));
  const roomIds = new Set(rooms.filter(candidate => room.agentRole === 'operations' || candidate.id === room.id || teamIds.has(candidate.parentTeam)).map(candidate => candidate.id));
  roomIds.add(room.id);
  const scoped = workflows.filter(workflow => room.agentRole === 'operations' || (workflow.team_id ? teamIds.has(workflow.team_id) : Boolean(workflow.source_room_id && roomIds.has(workflow.source_room_id))));
  for (const workflow of scoped) if (workflow.source_room_id) roomIds.add(workflow.source_room_id);

  const items: AssistantTaskNoteItem[] = [];
  for (const workflow of scoped) {
    const base = { projectId: workflow.project_id, projectTitle: workflow.title, teamId: workflow.team_id };
    const detailById = new Map((workflow.tasks_detail ?? []).map(task => [task.task_id, task]));
    const nodes = new Map((workflow.nodes ?? []).map(node => [node.id, node]));
    const taskIds = new Set([...nodes.keys(), ...detailById.keys()]);
    for (const taskId of taskIds) {
      const node = nodes.get(taskId);
      const detail = detailById.get(taskId);
      items.push({
        ...base,
        id: JSON.stringify([workflow.team_id, workflow.project_id, taskId]),
        group: taskGroup(detail?.status || node?.status),
        title: node?.name || taskId,
        assignee: detail?.assigned_to || node?.assignee,
      });
    }
    for (const interrupt of workflow.interrupts ?? []) {
      items.push({ ...base, id: JSON.stringify([workflow.team_id, workflow.project_id, 'interrupt', interrupt.id]), group: 'confirmation', title: interrupt.description || interrupt.value || '项目等待确认' });
    }
  }
  for (const item of Object.values(confirmations).sort((a, b) => b.timestamp - a.timestamp)) {
    if (!roomIds.has(item.roomId)) continue;
    items.push({ id: `confirmation:${item.id}`, confirmationId: item.id, group: 'confirmation', title: item.question || `工具确认 · ${item.toolName}`, roomId: item.roomId });
  }
  return items;
}
