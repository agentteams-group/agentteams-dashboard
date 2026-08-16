import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import {
  listProjects,
  getProjectWorkflow,
  pauseProject,
  resumeProject,
  replanProject,
  cancelProjectTask,
  type ProjectSummary,
  type WorkflowResponse,
} from '@/lib/agentteams-projects-api';
import type { BoardProject, BoardTask, TaskStatus } from '@/hooks/use-task-board';

/**
 * Fetch the AgentTeams project list through the dashboard proxy
 * (`GET /api/agentteams/projects`). The full ProjectListResponse is
 * returned so callers can distinguish a real empty list from a degraded
 * controller (`degraded` / `degradedReason` / `error`).
 */
export function useProjects() {
  return useQuery({
    queryKey: ['agentteams-projects'],
    queryFn: () => listProjects(),
    refetchInterval: 15000,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Fetch one project's workflow graph (with task detail) through the
 * dashboard proxy (`GET /api/agentteams/projects/{id}/workflow?includeTasks=true`).
 * Disabled until a project id is selected.
 */
export function useProjectWorkflow(projectId: string | null, teamId?: string) {
  return useQuery({
    queryKey: ['agentteams-project-workflow', teamId ?? 'any', projectId ?? 'none'],
    queryFn: () =>
      getProjectWorkflow(projectId as string, {
        includeTasks: true,
        teamId,
      }),
    enabled: !!projectId,
    // Keep the detail fresh while a project is selected — mutations elsewhere
    // (e.g. an agent completing tasks) would otherwise never show up without
    // a manual refresh.
    refetchInterval: 15000,
    retry: 1,
  });
}

/** Shared cache invalidation for project write mutations (#1172): after a
 * pause/resume/replan the controller returns the refreshed workflow, but we
 * invalidate the queries anyway so list + detail re-sync with the new
 * status (the mutation's onSuccess also updates the detail cache directly). */
function invalidateProjectQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  teamId?: string,
) {
  const detailKey = ['agentteams-project-workflow', teamId ?? 'any', projectId];
  queryClient.invalidateQueries({ queryKey: detailKey });
  queryClient.invalidateQueries({ queryKey: ['agentteams-projects'] });
}

/** Pause the currently selected project, then refresh list + detail. */
export function usePauseProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { projectId: string; teamId?: string; reason?: string }) =>
      pauseProject(args.projectId, { reason: args.reason, teamId: args.teamId }),
    // Cache keys must match the subscription keys, which are built from the
    // REQUEST-time teamId (`teamId ?? 'any'`). Using the response's team_id
    // here writes a key nobody subscribes to when the request had no teamId
    // but the controller returns one (panel would lag up to refetchInterval).
    onSuccess: (workflow, args) => {
      queryClient.setQueryData(
        ['agentteams-project-workflow', args.teamId ?? 'any', args.projectId],
        workflow,
      );
      invalidateProjectQueries(queryClient, args.projectId, args.teamId);
    },
  });
}

/** Resume a paused project, then refresh list + detail. */
export function useResumeProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { projectId: string; teamId?: string }) =>
      resumeProject(args.projectId, { teamId: args.teamId }),
    onSuccess: (workflow, args) => {
      queryClient.setQueryData(
        ['agentteams-project-workflow', args.teamId ?? 'any', args.projectId],
        workflow,
      );
      invalidateProjectQueries(queryClient, args.projectId, args.teamId);
    },
  });
}

/** Replace a DAG project's plan (JSON tasks payload from the replan dialog),
 * then refresh list + detail. */
export function useReplanProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { projectId: string; teamId?: string; tasks: unknown[] }) =>
      replanProject(args.projectId, args.tasks, { teamId: args.teamId }),
    onSuccess: (workflow, args) => {
      queryClient.setQueryData(
        ['agentteams-project-workflow', args.teamId ?? 'any', args.projectId],
        workflow,
      );
      invalidateProjectQueries(queryClient, args.projectId, args.teamId);
    },
  });
}

/** Cancel a single task in a project, then refresh list + detail. */
export function useCancelProjectTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      projectId: string;
      taskId: string;
      teamId?: string;
      reason: string;
      replacementTaskId?: string;
    }) =>
      cancelProjectTask(args.projectId, args.taskId, {
        reason: args.reason,
        replacementTaskId: args.replacementTaskId,
        teamId: args.teamId,
      }),
    onSuccess: (workflow, args) => {
      queryClient.setQueryData(
        ['agentteams-project-workflow', args.teamId ?? 'any', args.projectId],
        workflow,
      );
      invalidateProjectQueries(queryClient, args.projectId, args.teamId);
    },
  });
}

// ----- Task board primary source (D5): Controller API over MinIO -----

/** Workflow node status → board TaskStatus (same remap as buildWorkflowDag). */
function workflowStatusToTaskStatus(status?: string): TaskStatus {
  switch (status) {
    case 'pending':
    case 'planned':
    case '':
      return 'pending';
    case 'delegated':
    case 'assigned':
      return 'assigned';
    case 'in-progress':
    case 'in_progress':
    case 'submitted':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'blocked':
    case 'cancelled':
    case 'revision':
      return 'blocked';
    default:
      return 'unknown';
  }
}

function resultStatusToOutcome(resultStatus?: string): BoardTask['outcome'] {
  switch (resultStatus) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'SUCCESS_WITH_NOTES':
      return 'SUCCESS_WITH_NOTES';
    case 'REVISION_NEEDED':
      return 'REVISION_NEEDED';
    case 'BLOCKED':
      return 'BLOCKED';
    default:
      return null;
  }
}

/** Map the Controller projects + workflows to the task-board shapes so the
 * existing board UI renders from the API primary source (D5). Dependencies
 * are rebuilt from workflow edges (edge source → target means target depends
 * on source) — this is also the D8 data-source upgrade for the DAG view. */
export function workflowToBoard(
  projects: ProjectSummary[],
  workflows: Map<string, WorkflowResponse>,
): { tasks: BoardTask[]; projects: BoardProject[] } {
  const boardTasks: BoardTask[] = [];
  const boardProjects: BoardProject[] = [];

  for (const proj of projects) {
    const wf = workflows.get(proj.project_id);
    boardProjects.push({
      runId: proj.project_id,
      name: proj.title,
      status: proj.status,
      roomId: wf?.source_room_id ?? '',
      leader: wf?.requester || undefined,
      workers: [],
      phases: [], // plan.md phases are MinIO-only; the API board renders tasks directly
      createdAt: 0,
      completedAt: undefined,
      source: 'api',
    });
    if (!wf) continue;

    // Dependencies: edge source -> target means target depends on source.
    const dependsOf = new Map<string, string[]>();
    for (const edge of wf.edges) {
      const list = dependsOf.get(edge.target) ?? [];
      list.push(edge.source);
      dependsOf.set(edge.target, list);
    }

    // Per-task detail (result_status → outcome) when includeTasks was fetched.
    const detailByTask = new Map(
      (wf.tasks_detail ?? []).map((t) => [t.task_id, t]),
    );

    for (const node of wf.nodes) {
      const detail = detailByTask.get(node.id);
      boardTasks.push({
        runId: node.id,
        title: node.name || node.id,
        status: workflowStatusToTaskStatus(node.status),
        assignedTo: node.assignee ?? '',
        projectId: proj.project_id,
        roomId: wf.source_room_id ?? '',
        dependsOn: dependsOf.get(node.id) ?? [],
        createdAt: 0,
        completedAt: detail?.status === 'completed' ? undefined : undefined,
        outcome: resultStatusToOutcome(detail?.result_status),
        spec: detail?.summary || undefined,
        source: 'api',
      });
    }
  }

  return { tasks: boardTasks, projects: boardProjects };
}

/** Primary task-board source: Controller projects + per-project workflow
 * (cap 20), mapped to the board shapes. Falls back to the MinIO board when
 * the API is degraded (list 404 = not deployed / 500 = controller error). */
export function useApiTaskBoard() {
  const listQuery = useProjects();
  const queryClient = useQueryClient();

  const projects = useMemo(
    () => (listQuery.data?.projects ?? []).slice(0, 20),
    [listQuery.data?.projects],
  );

  // Degraded = list endpoint responded with a degraded payload (404 API not
  // deployed / 500 controller error) OR the request failed entirely (network
  // / proxy down). In both cases the caller falls back to the MinIO board —
  // otherwise the board would render blank on a proxy outage.
  const degraded = listQuery.data?.degraded === true || listQuery.isError === true;

  const workflowQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['agentteams-project-workflow', p.team_id ?? 'any', p.project_id],
      queryFn: () =>
        getProjectWorkflow(p.project_id, { includeTasks: true, teamId: p.team_id }),
      enabled: !degraded,
      retry: 1,
      staleTime: 15000,
    })),
  });

  // Pure mapping, recomputed per render: <20 projects / ~100 tasks makes
  // this O(n) trivially cheap, and avoiding memo dependencies on the
  // useQueries results array (whose reference stability is not guaranteed)
  // removes a whole class of stale-memo bugs.
  const workflows = new Map<string, WorkflowResponse>();
  workflowQueries.forEach((q, i) => {
    if (q.data && projects[i]) workflows.set(projects[i].project_id, q.data);
  });
  const board = workflowToBoard(projects, workflows);

  return {
    ...board,
    degraded,
    degradedReason: listQuery.data?.degradedReason,
    isLoading: listQuery.isLoading,
    isRefetching: listQuery.isRefetching,
    // Refresh must re-pull the per-project workflows too — the list query
    // alone would leave stale workflow data behind (staleTime 15s).
    refetch: () => {
      void queryClient.invalidateQueries({
        queryKey: ['agentteams-project-workflow'],
      });
      void listQuery.refetch();
    },
  };
}
