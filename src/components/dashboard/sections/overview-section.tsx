'use client';

import { useManagers } from '@/hooks/use-agentteams-managers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useApiTaskBoard } from '@/hooks/use-projects';
import { WorkspaceHome } from './workspace-home';

export function OverviewSection() {
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const taskBoard = useApiTaskBoard();

  return (
    <WorkspaceHome
      teams={teams}
      managers={managers}
      workerCount={workers?.length}
      tasks={taskBoard.tasks}
      loading={taskBoard.isLoading}
      degraded={taskBoard.degraded}
    />
  );
}
