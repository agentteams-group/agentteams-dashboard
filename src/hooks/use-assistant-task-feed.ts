import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useProjects } from './use-projects';
import { getProjectWorkflow, type WorkflowResponse } from '@/lib/agentteams-projects-api';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';

/** The switcher and the open note share the same project/workflow query cache. */
export function useAssistantTaskFeed(room?: RoomInfo, enabled = true) {
  const list = useProjects(enabled);
  const client = useQueryClient();
  const projects = useMemo(() => (list.data?.projects ?? []).filter(project => !room || room.agentRole === 'operations' || !project.team_id || [room.parentTeam, room.team?.name, room.team?.teamName].includes(project.team_id)), [list.data?.projects, room]);
  const degraded = list.isError || Boolean(list.data?.degraded);
  const queries = useQueries({ queries: projects.map(project => ({
    queryKey: ['agentteams-project-workflow', project.team_id ?? 'any', project.project_id],
    queryFn: () => getProjectWorkflow(project.project_id, { includeTasks: true, teamId: project.team_id }),
    enabled: enabled && !degraded,
    refetchInterval: (query: { state: { data?: WorkflowResponse } }) => enabled && query.state.data?.status !== 'completed' ? 15000 : false as const,
    staleTime: 15000,
    retry: 1,
    throwOnError: false,
  })) });
  return {
    workflows: queries.flatMap((query, index) => query.data ? [{ ...query.data, team_id: query.data.team_id ?? projects[index].team_id }] : []),
    loading: list.isLoading || queries.some(query => query.isLoading),
    degraded,
    partialError: queries.some(query => query.isError),
    refresh: () => { void list.refetch(); void client.invalidateQueries({ queryKey: ['agentteams-project-workflow'] }); },
  };
}

export type AssistantTaskFeed = ReturnType<typeof useAssistantTaskFeed>;
