import { useMemo } from 'react';
import { useProjectWorkflowBatch } from './use-project-workflow-batch';
import type { RoomInfo } from '@/components/dashboard/sections/chat/room-info';

/** The switcher and the open note share the same aggregate workflow cache. */
export function useAssistantTaskFeed(room?: RoomInfo, enabled = true) {
  const feed = useProjectWorkflowBatch({ enabled, room });
  const workflows = useMemo(() => (room
    ? feed.workflows.filter(workflow => room.agentRole === 'operations' || !workflow.team_id
      || [room.parentTeam, room.team?.name, room.team?.teamName].includes(workflow.team_id))
    : feed.workflows), [feed.workflows, room]);
  return {
    workflows,
    loading: feed.loading,
    degraded: feed.degraded,
    partialError: feed.partialError,
    refresh: feed.refresh,
  };
}

export type AssistantTaskFeed = ReturnType<typeof useAssistantTaskFeed>;
