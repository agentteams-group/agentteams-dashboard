'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { TeamTopologyDiagram } from './team-topology';

export function TeamTopologyDialog({
  team,
  workers,
  onOpenChange,
}: {
  team: TeamResponse | null;
  workers: WorkerResponse[];
  onOpenChange: (_open: boolean) => void;
}) {
  return (
    <Dialog open={!!team} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>团队拓扑 - {team?.name}</DialogTitle>
        </DialogHeader>
        {team && <TeamTopologyDiagram team={team} workers={workers} />}
      </DialogContent>
    </Dialog>
  );
}
