import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listProjects,
  getProjectWorkflow,
  pauseProject,
  resumeProject,
  replanProject,
  cancelProjectTask,
} from '@/lib/agentteams-projects-api';

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
