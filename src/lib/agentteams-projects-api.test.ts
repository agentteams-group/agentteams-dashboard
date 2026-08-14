// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listProjects, getProjectWorkflow, getTaskArtifactUrl } from './agentteams-projects-api';
import { ApiError, NetworkError } from './api-error';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('listProjects', () => {
  it('returns projects on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          projects: [
            { project_id: 'p1', title: 'A', status: 'active', team_id: 'biz' },
          ],
          total: 1,
        }),
        { status: 200 },
      ),
    ) as never;

    const data = await listProjects();
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].project_id).toBe('p1');
    expect(data.total).toBe(1);
    expect(data.degraded).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/agentteams/projects', {
      cache: 'no-store',
    });
  });

  it('returns empty array when controller API is degraded (200 + error)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projects: [], total: 0, error: 'HTTP 404', degraded: true }), {
        status: 200,
      }),
    ) as never;
    const data = await listProjects();
    expect(data.projects).toEqual([]);
    expect(data.degraded).toBe(true);
    expect(data.error).toContain('HTTP 404');
  });

  it('throws ApiError on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    ) as never;
    await expect(listProjects()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws NetworkError when fetch rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as never;
    await expect(listProjects()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('getProjectWorkflow', () => {
  it('returns workflow on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          project_id: 'p1',
          title: 'A',
          status: 'active',
          nodes: [{ id: 't1', name: 'T1', status: 'delegated' }],
          edges: [],
          next: ['t1'],
          interrupts: [],
          values: { project_id: 'p1', title: 'A', status: 'active' },
        }),
        { status: 200 },
      ),
    ) as never;

    const wf = await getProjectWorkflow('p1');
    expect(wf.nodes).toHaveLength(1);
    expect(wf.nodes[0].status).toBe('delegated');
    expect(fetch).toHaveBeenCalledWith('/api/agentteams/projects/p1/workflow', {
      cache: 'no-store',
    });
  });

  it('encodes the project id in the URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ project_id: 'x', nodes: [], edges: [], next: [], interrupts: [], values: {} }), {
        status: 200,
      }),
    ) as never;
    await getProjectWorkflow('a/b c');
    expect(fetch).toHaveBeenCalledWith('/api/agentteams/projects/a%2Fb%20c/workflow', {
      cache: 'no-store',
    });
  });

  it('appends includeTasks=true query when requested', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          project_id: 'p1',
          nodes: [],
          edges: [],
          next: [],
          interrupts: [],
          values: {},
        }),
        { status: 200 },
      ),
    ) as never;
    await getProjectWorkflow('p1', { includeTasks: true });
    expect(fetch).toHaveBeenCalledWith('/api/agentteams/projects/p1/workflow?includeTasks=true', {
      cache: 'no-store',
    });
  });

  it('parses extended interrupt fields (action_request/config/description)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          project_id: 'p1',
          nodes: [],
          edges: [],
          next: [],
          interrupts: [
            {
              id: 'project',
              value: 'paused',
              action_request: { action: 'resume', args: { project_id: 'p1' } },
              config: { allow_ignore: false, allow_respond: false, allow_edit: false, allow_accept: true },
              description: 'project is paused: waiting on review',
            },
          ],
          values: {},
        }),
        { status: 200 },
      ),
    ) as never;

    const wf = await getProjectWorkflow('p1');
    expect(wf.interrupts).toHaveLength(1);
    const interrupt = wf.interrupts[0];
    expect(interrupt.action_request?.action).toBe('resume');
    expect(interrupt.action_request?.args).toEqual({ project_id: 'p1' });
    expect(interrupt.config?.allow_accept).toBe(true);
    expect(interrupt.description).toContain('waiting on review');
  });

  it('parses tasks_detail and audit fields when includeTasks=true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          project_id: 'p1',
          nodes: [],
          edges: [],
          next: [],
          interrupts: [],
          values: {},
          tasks_detail: [
            {
              task_id: 't1',
              project_id: 'p1',
              status: 'in_progress',
              spec_path: '/root/agentteams-fs/agents/sysdev/shared/specs/s1.md',
              assigned_to: 'sysdev',
              summary: 'halfway',
              result_status: '',
              deliverables: [],
              result_path: '',
            },
          ],
          source: 'team',
          requester: 'luo',
          requester_report: { channel: 'qq' },
          reply_route: { target: 'room' },
          source_room_id: '!abc',
          updated_by: 'luo',
          updated_at: '2026-08-12T00:00:00Z',
          pause_reason: 'waiting on review',
        }),
        { status: 200 },
      ),
    ) as never;

    const wf = await getProjectWorkflow('p1', { includeTasks: true });
    expect(wf.tasks_detail).toHaveLength(1);
    expect(wf.tasks_detail?.[0].task_id).toBe('t1');
    expect(wf.tasks_detail?.[0].spec_path).toContain('specs/s1.md');
    expect(wf.source).toBe('team');
    expect(wf.requester_report).toEqual({ channel: 'qq' });
    expect(wf.source_room_id).toBe('!abc');
    expect(wf.pause_reason).toBe('waiting on review');
  });

  it('passes ?team= when teamId is provided (409 disambiguation, #1169)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nodes: [], edges: [], values: {} }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as never;
    await getProjectWorkflow('p1', { teamId: 'sysdev-team' });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('team=sysdev-team');
    expect(url).toContain('/p1/workflow');
  });

  it('combines includeTasks and team query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nodes: [], edges: [], values: {} }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as never;
    await getProjectWorkflow('p1', { includeTasks: true, teamId: 'sysdev-team' });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('includeTasks=true');
    expect(url).toContain('team=sysdev-team');
  });

  it('throws ApiError on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 }),
    ) as never;
    await expect(getProjectWorkflow('missing')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError on 409 (ambiguous id across teams)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'ambiguous project id, pass ?team=' }), { status: 409 }),
    ) as never;
    const err = await getProjectWorkflow('shared-id').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });

  it('throws NetworkError when fetch rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as never;
    await expect(getProjectWorkflow('p1')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('getTaskArtifactUrl', () => {
  it('builds the artifact proxy URL without a path', () => {
    expect(getTaskArtifactUrl('p1', 't1')).toBe('/api/agentteams/projects/p1/tasks/t1/artifact');
  });

  it('builds the artifact proxy URL with an encoded deliverable path', () => {
    expect(getTaskArtifactUrl('p1', 't1', 'results/方案.md')).toBe(
      '/api/agentteams/projects/p1/tasks/t1/artifact?path=results%2F%E6%96%B9%E6%A1%88.md',
    );
  });

  it('encodes project/task ids in the URL', () => {
    expect(getTaskArtifactUrl('a/b', 't t')).toBe(
      '/api/agentteams/projects/a%2Fb/tasks/t%20t/artifact',
    );
  });
});
