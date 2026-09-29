'use client';

import { useMemo, useState } from 'react';
import type { RoomMember } from '@/hooks/use-matrix';
import type { TeamResponse } from '@/lib/agentteams-api';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { RuntimeMap } from '../runtime-map-context';
import type { WorkerFileOption } from '../components/WorkersFilesSidebar';

interface UseWorkerFileOptionsParams {
  team?: TeamResponse;
  roomMembers: RoomMember[];
  runtimeMap: RuntimeMap;
  defaultWorkerName?: string;
}

export function useWorkerFileOptions({
  team,
  roomMembers,
  runtimeMap,
  defaultWorkerName,
}: UseWorkerFileOptionsParams) {
  // Worker rooms default to the owning worker so the files panel opens on
  // "the current worker's" directory instead of an empty picker.
  const [selectedWorker, setSelectedWorker] = useState<string | null>(defaultWorkerName ?? null);
  const TEAM_SHARED_VALUE = '__team_shared__';

  // Worker options for the files panel. Team rooms lead with the team shared
  // workspace (agentteams layout: teams/{team}/shared/ — tasks/projects
  // produced by TeamHarness MCP) followed by the authoritative
  // `team.workerNames` roster (Matrix member lists may miss workers that
  // never spoke in the room due to lazy-loaded membership); other rooms fall
  // back to runtimeMap-resolved room members.
  const workerOptions = useMemo<WorkerFileOption[]>(() => {
    const byWorkerName = new Map(
      Object.values(runtimeMap).map((entry) => [entry.workerName, entry]),
    );
    const toOption = (workerName: string, userId?: string) => {
      const entry = byWorkerName.get(workerName) ?? (userId ? runtimeMap[userId] : undefined);
      if (!entry) return null;
      const runtimeLabel = RUNTIME_LABELS[entry.runtime] || entry.runtime;
      return {
        userId: userId ?? `worker:${workerName}`,
        workerName,
        label: `${workerName} · ${runtimeLabel}`,
      };
    };
    const teamOption = team
      ? { userId: TEAM_SHARED_VALUE, workerName: TEAM_SHARED_VALUE, label: `团队共享空间 · teams/${team.name}/shared` }
      : null;
    const workerEntries: WorkerFileOption[] = [];
    if (team?.workerNames?.length) {
      const mxidByWorkerName = new Map(
        roomMembers
          .map((m) => (runtimeMap[m.userId] ? ([runtimeMap[m.userId].workerName, m.userId] as const) : null))
          .filter((x): x is readonly [string, string] => x !== null),
      );
      for (const name of team.workerNames) {
        const opt = toOption(name, mxidByWorkerName.get(name));
        if (opt) workerEntries.push(opt);
      }
    } else {
      for (const m of roomMembers) {
        if (!runtimeMap[m.userId]) continue;
        const opt = toOption(runtimeMap[m.userId].workerName, m.userId);
        if (opt) workerEntries.push(opt);
      }
    }
    return teamOption ? [teamOption, ...workerEntries] : workerEntries;
  }, [team, roomMembers, runtimeMap]);

  // Team rooms open on the shared workspace (the team's own space); worker
  // rooms keep their owning worker; other rooms fall back to the first option.
  const effectiveSelectedWorker =
    selectedWorker
    ?? (team ? TEAM_SHARED_VALUE : undefined)
    ?? defaultWorkerName
    ?? workerOptions[0]?.workerName
    ?? null;
  const selectedIsTeamShared = effectiveSelectedWorker === TEAM_SHARED_VALUE;

  return {
    workerOptions,
    effectiveSelectedWorker,
    selectedIsTeamShared,
    selectedWorker,
    setSelectedWorker,
  };
}
