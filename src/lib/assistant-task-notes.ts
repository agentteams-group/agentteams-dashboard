import type { WorkflowResponse } from './agentteams-projects-api';
import type { HitlConfirmation } from './hitl-inbox';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';
import { formatDurationZh } from './worker-activity';

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
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  confirmationId?: string;
}

export function attentionCounts(items: AssistantTaskNoteItem[]) {
  return {
    confirmation: items.filter(item => item.group === 'confirmation').length,
    review: items.filter(item => item.group === 'review').length,
    failed: items.filter(item => item.group === 'failed').length,
  };
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

  const items = workflowTaskNotes(scoped);
  for (const item of Object.values(confirmations).sort((a, b) => b.timestamp - a.timestamp)) {
    if (!roomIds.has(item.roomId)) continue;
    items.push({ id: `confirmation:${item.id}`, confirmationId: item.id, group: 'confirmation', title: item.question || `工具确认 · ${item.toolName}`, roomId: item.roomId });
  }
  return items;
}

/** Preserve raw task status for task summaries and intervention lists. */
export function workflowTaskNotes(workflows: WorkflowResponse[]): AssistantTaskNoteItem[] {
  const items: AssistantTaskNoteItem[] = [];
  for (const workflow of workflows) {
    const base = { projectId: workflow.project_id, projectTitle: workflow.title, teamId: workflow.team_id };
    const detailById = new Map((workflow.tasks_detail ?? []).map(task => [task.task_id, task]));
    const nodes = new Map((workflow.nodes ?? []).map(node => [node.id, node]));
    const taskIds = new Set([...nodes.keys(), ...detailById.keys()]);
    for (const taskId of taskIds) {
      const node = nodes.get(taskId);
      const detail = detailById.get(taskId);
      const status = detail?.status || node?.status;
      const history = detail?.history ?? [];
      const startedAt = history.find(event => ['in_progress', 'in-progress', 'running'].includes(event.to))?.ts
        ?? history.find(event => ['assigned', 'delegated'].includes(event.to))?.ts;
      const finishedAt = ['submitted', 'completed', 'failed', 'error', 'cancelled', 'canceled'].includes(status ?? '')
        ? [...history].reverse().find(event => event.to === status)?.ts : undefined;
      items.push({
        ...base,
        id: JSON.stringify([workflow.team_id, workflow.project_id, taskId]),
        group: taskGroup(status),
        status,
        startedAt,
        finishedAt,
        title: node?.name || taskId,
        assignee: detail?.assigned_to || node?.assignee,
        roomId: detail?.room_id?.replace(/^room:/, ''),
      });
    }
    for (const interrupt of workflow.interrupts ?? []) {
      items.push({ ...base, id: JSON.stringify([workflow.team_id, workflow.project_id, 'interrupt', interrupt.id]), group: 'confirmation', title: interrupt.description || interrupt.value || '项目等待确认' });
    }
  }
  return items;
}

/** Execution time stops on submission; acceptance waiting is not execution. */
export function taskDuration(item: AssistantTaskNoteItem, now: number): string {
  if (!item.startedAt) return item.group === 'pending' ? '未开始' : '耗时待同步';
  const finished = ['review', 'completed', 'failed', 'cancelled'].includes(item.group);
  if (finished && !item.finishedAt) return '耗时待同步';
  const end = item.finishedAt ? Date.parse(item.finishedAt) : now;
  return Number.isFinite(end) ? formatDurationZh(item.startedAt, end) ?? '耗时待同步' : '耗时待同步';
}

/** Conversation tips use explicit origin links, not platform/team-wide scope. */
export function conversationTaskNotes(room: RoomInfo, workflows: WorkflowResponse[]): AssistantTaskNoteItem[] {
  const matches = (value: unknown) => typeof value === 'string' && value.replace(/^room:/, '') === room.id;
  return workflows.flatMap(workflow => {
    const fromConversation = matches(workflow.source_room_id)
      || workflow.reply_route?.channel === 'matrix' && matches(workflow.reply_route.target_session);
    const taskIds = new Set((workflow.tasks_detail ?? []).filter(task => matches(task.source_room_id)).map(task => task.task_id));
    const scoped = fromConversation ? workflow : {
      ...workflow,
      nodes: workflow.nodes.filter(node => taskIds.has(node.id)),
      tasks_detail: workflow.tasks_detail?.filter(task => taskIds.has(task.task_id)),
    };
    return workflowTaskNotes([{ ...scoped, interrupts: [] }]).map(item => ({
      ...item,
      roomId: item.roomId === room.id ? undefined : item.roomId,
    }));
  });
}
