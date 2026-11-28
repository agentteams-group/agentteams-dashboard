// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { workflowToBoard, mergeMainTaskIndex, groupLegacyProjectTasks } from './use-projects';
import { mainTasks, subtaskProgress } from '@/lib/task-hierarchy';
import type { WorkflowResponse, ProjectSummary, WorkflowNodeStatus } from '@/lib/agentteams-projects-api';

function proj(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    project_id: 'p1',
    title: 'P',
    status: 'active',
    team_id: 't1',
    ...overrides,
  };
}

function wf(overrides: Partial<WorkflowResponse> = {}): WorkflowResponse {
  return {
    project_id: 'p1',
    title: 'P',
    status: 'active',
    nodes: [],
    edges: [],
    next: [],
    interrupts: [],
    ...overrides,
  };
}

describe('workflowToBoard (D5 API primary mapping)', () => {
  it('keeps Leader acceptance authoritative over the Worker submission snapshot', () => {
    const { tasks } = workflowToBoard([proj()], new Map([['p1', wf({
      nodes: [{ id: 'analysis', name: '需求分析', status: 'completed' }],
      tasks_detail: [{ task_id: 'analysis', status: 'submitted', result_status: 'SUCCESS' }],
    })]]));
    expect(tasks[0]).toMatchObject({ status: 'completed', outcome: 'SUCCESS' });
  });
  it('preserves parent tasks independently of the dependency graph', () => {
    const {tasks}=workflowToBoard([proj()],new Map([['p1',wf({nodes:[{id:'main',name:'主任务',status:'pending'},{id:'child',name:'执行任务',status:'pending',parent_task_id:'main'}],edges:[]})]]));
    expect(tasks.find(t=>t.runId==='child')).toMatchObject({parentTaskId:'main',dependsOn:[]});
  });
  it('keeps the execution room separate from the task source conversation', () => {
    const { tasks } = workflowToBoard([proj()], new Map([['p1', wf({
      source_room_id: '!project-source:test',
      nodes: [{ id: 't1', name: '执行分析', status: 'in-progress' }],
      tasks_detail: [{ task_id: 't1', room_id: 'room:!execution:test', source_room_id: '!task-source:test' }],
    })]]));
    expect(tasks[0]).toMatchObject({ roomId: '!task-source:test', executionRoomId: '!execution:test', teamId: 't1' });
    const legacy = workflowToBoard([proj()], new Map([['p1', wf({ source_room_id: '!source:test', nodes: [{ id: 't1', name: '执行分析', status: 'pending' }] })]]));
    expect(legacy.tasks[0].executionRoomId).toBeUndefined();
  });
  it('maps projects to BoardProject shape', () => {
    const wfs = new Map([['p1', wf()]]);
    const { projects } = workflowToBoard([proj()], wfs);
    expect(projects).toHaveLength(1);
    expect(projects[0].runId).toBe('p1');
    expect(projects[0].name).toBe('P');
    expect(projects[0].status).toBe('active');
    expect(projects[0].source).toBe('api');
    expect(projects[0].roomId).toBe(''); // no source_room_id
  });

  it('maps nodes to tasks with status remap + dependsOn rebuilt from edges', () => {
    const wfs = new Map([
      ['p1', wf({
        source_room_id: '!room',
        nodes: [
          { id: 't1', name: '采集', status: 'completed' },
          { id: 't2', name: '整理', status: 'in-progress', assignee: 'alice' },
          { id: 't3', name: '报告', status: 'pending' },
        ],
        edges: [
          { source: 't1', target: 't2' },
          { source: 't2', target: 't3' },
        ],
      })],
    ]);
    const { tasks } = workflowToBoard([proj()], wfs);
    const byId = new Map(tasks.map((t) => [t.runId, t]));
    expect(byId.get('t1')!.status).toBe('completed');
    expect(byId.get('t2')!.status).toBe('in_progress'); // in-progress → in_progress
    expect(byId.get('t2')!.assignedTo).toBe('alice');
    expect(byId.get('t2')!.dependsOn).toEqual(['t1']);
    expect(byId.get('t3')!.dependsOn).toEqual(['t2']);
    expect(byId.get('t1')!.projectId).toBe('p1');
    expect(byId.get('t2')!.source).toBe('api');
  });

  it('maps tasks_detail outcome + spec (summary)', () => {
    const wfs = new Map([
      ['p1', wf({
        nodes: [{ id: 't1', name: 'A', status: 'completed' }],
        edges: [],
        tasks_detail: [
          {
            task_id: 't1',
            status: 'completed',
            result_status: 'SUCCESS_WITH_NOTES',
            summary: '摘要文本',
          },
        ],
      })],
    ]);
    const { tasks } = workflowToBoard([proj()], wfs);
    expect(tasks[0].outcome).toBe('SUCCESS_WITH_NOTES');
    expect(tasks[0].spec).toBe('摘要文本');
  });

  it('keeps cancelled terminal instead of treating it as blocked', () => {
    const wfs = new Map([
      ['p1', wf({
        nodes: [
          { id: 'a', name: 'A', status: 'revision' },
          // Preserve raw cancellation if the API provides it.
          { id: 'b', name: 'B', status: 'cancelled' as WorkflowNodeStatus },
          { id: 'c', name: 'C', status: 'weird-future' as WorkflowNodeStatus },
        ],
        edges: [],
      })],
    ]);
    const { tasks } = workflowToBoard([proj()], wfs);
    const statusOf = new Map(tasks.map((t) => [t.runId, t.status]));
    expect(statusOf.get('a')).toBe('revision');
    expect(statusOf.get('b')).toBe('cancelled');
    expect(statusOf.get('c')).toBe('unknown');
  });

  it('skips projects without a workflow response (tasks empty, project kept)', () => {
    const { tasks, projects } = workflowToBoard([proj(), proj({ project_id: 'p2' })], new Map());
    expect(projects).toHaveLength(2);
    expect(tasks).toHaveLength(0);
  });

  it('surfaces requester as leader', () => {
    const wfs = new Map([['p1', wf({ requester: '@manager:hs' })]]);
    const { projects } = workflowToBoard([proj()], wfs);
    expect(projects[0].leader).toBe('@manager:hs');
  });
});

it('preserves submitted detail status when workflow nodes normalize it to in-progress', () => {
  const { tasks } = workflowToBoard([proj()], new Map([['p1', wf({
    nodes: [{ id: 'review', name: 'Report', status: 'in-progress' }],
    tasks_detail: [{ task_id: 'review', status: 'submitted' }],
  })]]));
  expect(tasks[0].status).toBe('submitted');
});


describe('main Task index', () => {
  it('shows a no-Project main task and its children without synthesizing a Project', () => {
    const tasks = mergeMainTaskIndex([], [
      { task_id: 'main', main_task_id: 'main', title: 'Main', team_id: 'alpha', status: 'in_progress', room_id: '!work:test', source_room_id: '!source:test' },
      { task_id: 'child', main_task_id: 'main', parent_task_id: 'main', title: 'Child', team_id: 'alpha', status: 'planned', depends_on: [] },
    ]);
    expect(tasks[0]).toMatchObject({ runId: 'main', projectId: undefined, status: 'in_progress', executionRoomId: '!work:test', roomId: '!source:test' });
    expect(tasks[1]).toMatchObject({ parentTaskId: 'main', status: 'pending' });
  });
  it('keeps same-named tasks in different teams separate', () => {
    const rows = ['alpha', 'beta'].map(team_id => ({ task_id: 'main', main_task_id: 'main', title: 'Main', team_id, status: 'completed' }));
    expect(mergeMainTaskIndex([], rows)).toHaveLength(2);
  });
});


it('shows one completed board card for a legacy project and keeps its execution nodes in the hierarchy', () => {
  const { tasks, projects } = workflowToBoard([proj({ status: 'completed' })], new Map([['p1', wf({
    status: 'completed',
    nodes: [{ id: 'plan', name: 'Plan', status: 'completed' }, { id: 'review', name: 'Review', status: 'completed' }],
    edges: [{ source: 'plan', target: 'review' }],
    tasks_detail: [{ task_id: 'plan', room_id: 'room:!task:test' }, { task_id: 'review', room_id: 'room:!task:test' }],
  })]]));
  const grouped = groupLegacyProjectTasks(tasks, projects);
  const roots = mainTasks(grouped);
  expect(roots).toHaveLength(1);
  expect(roots[0]).toMatchObject({ runId: 'p1', status: 'completed', executionRoomId: '!task:test' });
  expect(subtaskProgress(roots[0], grouped)).toEqual({ completed: 2, total: 2, percent: 100 });
  expect(grouped.find(task => task.runId === 'review')).toMatchObject({ parentTaskId: 'p1', dependsOn: ['plan'] });
});
