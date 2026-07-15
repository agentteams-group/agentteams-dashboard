// Phase Change Detection Hook
// Watches React Query cache for worker/team/manager phase transitions
// and fires notifications when phases change

import { useEffect, useRef } from 'react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useNotificationStore } from '@/lib/notification-store';
import type { WorkerResponse, TeamResponse, ManagerResponse } from '@/lib/agentteams-api';

function detectWorkerChanges(prev: WorkerResponse[], curr: WorkerResponse[]) {
  const prevMap = new Map(prev.map((w) => [w.name, w]));
  const notifications: Array<{ title: string; message: string; severity: 'warning' | 'error' | 'info' }> = [];

  for (const w of curr) {
    const p = prevMap.get(w.name);
    if (!p) {
      // New worker
      continue;
    }
    if (p.phase !== w.phase) {
      const severity = w.phase === 'Failed' ? 'error' : w.phase === 'Running' || w.phase === 'Ready' ? 'info' : 'warning';
      notifications.push({
        title: `Worker "${w.name}" 状态变更`,
        message: `${p.phase} → ${w.phase}`,
        severity,
      });
    }
  }

  // Detect deleted workers
  const currMap = new Map(curr.map((w) => [w.name, w]));
  for (const p of prev) {
    if (!currMap.has(p.name)) {
      notifications.push({
        title: `Worker "${p.name}" 已移除`,
        message: '该 Worker 已从集群中删除',
        severity: 'warning',
      });
    }
  }

  return notifications;
}

function detectTeamChanges(prev: TeamResponse[], curr: TeamResponse[]) {
  const prevMap = new Map(prev.map((t) => [t.name, t]));
  const notifications: Array<{ title: string; message: string; severity: 'warning' | 'error' | 'info' }> = [];

  for (const t of curr) {
    const p = prevMap.get(t.name);
    if (!p) continue;
    if (p.phase !== t.phase) {
      const severity = t.phase === 'Failed' ? 'error' : t.phase === 'Active' ? 'info' : 'warning';
      notifications.push({
        title: `团队 "${t.teamName || t.name}" 状态变更`,
        message: `${p.phase} → ${t.phase}`,
        severity,
      });
    }
  }

  return notifications;
}

export function usePhaseWatcher() {
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const addNotification = useNotificationStore((s) => s.addNotification);

  const prevWorkersRef = useRef<WorkerResponse[] | undefined>(undefined);
  const prevTeamsRef = useRef<TeamResponse[] | undefined>(undefined);
  const prevManagersRef = useRef<ManagerResponse[] | undefined>(undefined);
  const initializedRef = useRef(false);

  useEffect(() => {
    // Skip the first render to avoid false positives on page load
    if (!initializedRef.current) {
      prevWorkersRef.current = workers;
      prevTeamsRef.current = teams;
      prevManagersRef.current = managers;
      initializedRef.current = true;
      return;
    }

    // Detect worker changes
    if (workers && prevWorkersRef.current) {
      const changes = detectWorkerChanges(prevWorkersRef.current, workers);
      for (const c of changes) {
        addNotification({
          type: c.severity === 'error' ? 'error' : c.severity === 'warning' ? 'warning' : 'info',
          title: c.title,
          message: c.message,
          origin: 'system',
          actionUrl: '#workers',
        });
      }
    }

    // Detect team changes
    if (teams && prevTeamsRef.current) {
      const changes = detectTeamChanges(prevTeamsRef.current, teams);
      for (const c of changes) {
        addNotification({
          type: c.severity === 'error' ? 'error' : c.severity === 'warning' ? 'warning' : 'info',
          title: c.title,
          message: c.message,
          origin: 'system',
          actionUrl: '#teams',
        });
      }
    }

    // Update refs
    prevWorkersRef.current = workers ?? undefined;
    prevTeamsRef.current = teams ?? undefined;
    prevManagersRef.current = managers ?? undefined;
  }, [workers, teams, managers, addNotification]);
}
