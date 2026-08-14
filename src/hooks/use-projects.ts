import { useQuery } from '@tanstack/react-query';
import { listProjects, getProjectWorkflow } from '@/lib/agentteams-projects-api';

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
    retry: 1,
  });
}
