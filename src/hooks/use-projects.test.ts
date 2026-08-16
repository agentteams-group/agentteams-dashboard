// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { workflowToBoard } from './use-projects';
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

  it('maps revision/blocked statuses to blocked; unknown to unknown', () => {
    const wfs = new Map([
      ['p1', wf({
        nodes: [
          { id: 'a', name: 'A', status: 'revision' },
          // Controller normalizes cancelled→blocked already; these casts
          // exercise the mapper's defensive branches.
          { id: 'b', name: 'B', status: 'cancelled' as WorkflowNodeStatus },
          { id: 'c', name: 'C', status: 'weird-future' as WorkflowNodeStatus },
        ],
        edges: [],
      })],
    ]);
    const { tasks } = workflowToBoard([proj()], wfs);
    const statusOf = new Map(tasks.map((t) => [t.runId, t.status]));
    expect(statusOf.get('a')).toBe('blocked');
    expect(statusOf.get('b')).toBe('blocked');
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
