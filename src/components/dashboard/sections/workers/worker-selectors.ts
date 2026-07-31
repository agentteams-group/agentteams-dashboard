import type { WorkerResponse } from '@/lib/agentteams-api';
import type { SortKey } from './worker-types';

// ============ Basic Operations ============

export function filterWorkers(
  workers: WorkerResponse[] | undefined,
  searchQuery: string
): WorkerResponse[] {
  if (!workers) return [];
  if (!searchQuery) return workers;
  const q = searchQuery.toLowerCase();
  return workers.filter(
    (w) =>
      w.name?.toLowerCase().includes(q) ||
      w.model?.toLowerCase().includes(q) ||
      w.runtime?.toLowerCase().includes(q) ||
      w.team?.toLowerCase().includes(q)
  );
}

export function sortWorkers(workers: WorkerResponse[], sortKey: SortKey): WorkerResponse[] {
  const sorted = [...workers];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'phase':
        return a.phase.localeCompare(b.phase);
      case 'runtime':
        return a.runtime.localeCompare(b.runtime);
      case 'team':
        return (a.team || '').localeCompare(b.team || '');
      default:
        return 0;
    }
  });
  return sorted;
}

export function paginateWorkers(
  workers: WorkerResponse[],
  page: number,
  pageSize: number
): { totalPages: number; safePage: number; items: WorkerResponse[] } {
  const totalPages = Math.max(1, Math.ceil(workers.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { totalPages, safePage, items: workers.slice(start, start + pageSize) };
}

export function computeRuntimeDist(workers: WorkerResponse[] | undefined): Record<string, number> {
  const dist: Record<string, number> = {};
  workers?.forEach((w) => {
    dist[w.runtime] = (dist[w.runtime] || 0) + 1;
  });
  return dist;
}

// ============ New Worker Metrics Observations ============

/** Count workers by phase */
export function countByPhase(workers: WorkerResponse[] | undefined): Record<string, number> {
  if (!workers) return { Running: 0, Ready: 0, Sleeping: 0, Failed: 0, Pending: 0, Updating: 0, Stopped: 0 };
  const counts: Record<string, number> = {};
  const phases = ['Pending', 'Running', 'Sleeping', 'Updating', 'Stopped', 'Failed', 'Ready'];
  phases.forEach(p => counts[p] = 0);
  
  workers.forEach(w => {
    if (counts[w.phase] !== undefined) counts[w.phase]++;
  });
  
  return counts;
}

/** Get failed worker names */
export function getFailedWorkers(workers: WorkerResponse[] | undefined): string[] {
  if (!workers) return [];
  return workers.filter(w => w.phase === 'Failed').map(w => w.name);
}

/** Get pending worker names */
export function getPendingWorkers(workers: WorkerResponse[] | undefined): string[] {
  if (!workers) return [];
  return workers.filter(w => w.phase === 'Pending').map(w => w.name);
}

/** Calculate health distribution without relying on React hooks */
export function getHealthDistributionStatic(workers: WorkerResponse[] | undefined): { healthy: number; degraded: number; critical: number; total: number } {
  if (!workers) return { healthy: 0, degraded: 0, critical: 0, total: 0 };
  let healthy = 0, degraded = 0, critical = 0;
  
  workers.forEach(w => {
    const PHASE_SCORES = { Running: 100, Ready: 100, Sleeping: 70, Pending: 40, Updating: 50, Stopped: 20, Failed: 0 };
    const phaseScore = PHASE_SCORES[w.phase] || 50;
    
    if (phaseScore >= 70) healthy++;
    else if (phaseScore >= 40) degraded++;
    else critical++;
  });
  
  return { healthy, degraded, critical, total: workers.length };
}

/** Calculate average health score */
export function getAverageHealthScore(workers: WorkerResponse[] | undefined): number | null {
  if (!workers || workers.length === 0) return null;
  
  let totalScore = 0;
  workers.forEach(w => {
    const PHASE_SCORES = { Running: 100, Ready: 100, Sleeping: 70, Pending: 40, Updating: 50, Stopped: 20, Failed: 0 };
    const containerStateScores = { running: 100, created: 60, restarting: 30, removing: 10, paused: 40, exited: 10, dead: 0 };
    
    const availability = PHASE_SCORES[w.phase] || 50;
    const stability = containerStateScores[w.containerState?.toLowerCase() ?? ''] || 60;
    
    let readiness = 50;
    if (w.phase === 'Failed' && w.message) readiness = 0;
    else if (w.matrixUserID && w.roomID) readiness = 100;
    else if (w.matrixUserID || w.roomID) readiness = 70;
    
    const overall = Math.round(availability * 0.5 + stability * 0.3 + readiness * 0.2);
    totalScore += overall;
  });
  
  return Math.round(totalScore / workers.length);
}

/** Group workers by team */
export function groupByTeam(workers: WorkerResponse[] | undefined): Record<string, WorkerResponse[]> {
  if (!workers) return {};
  const byTeam: Record<string, WorkerResponse[]> = {};
  workers.forEach(w => {
    const team = w.team || 'Unassigned';
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push(w);
  });
  return byTeam;
}

/** Group workers by runtime */
export function groupByRuntime(workers: WorkerResponse[] | undefined): Record<string, WorkerResponse[]> {
  if (!workers) return {};
  const byRuntime: Record<string, WorkerResponse[]> = {};
  workers.forEach(w => {
    if (!byRuntime[w.runtime]) byRuntime[w.runtime] = [];
    byRuntime[w.runtime].push(w);
  });
  return byRuntime;
}

/** Get unique skills across all workers */
export function getUniqueSkills(workers: WorkerResponse[] | undefined): Set<string> {
  if (!workers) return new Set<string>();
  const skills = new Set<string>();
  workers.forEach(w => {
    w.skills?.forEach(s => skills.add(s));
  });
  return skills;
}

/** Check if any worker has mcpServers */
export function hasMCPServers(workers: WorkerResponse[] | undefined): boolean {
  if (!workers) return false;
  return workers.some(w => w.mcpServers && w.mcpServers.length > 0);
}

/** Get exposed ports summary */
export function getExposedPortsSummary(workers: WorkerResponse[] | undefined): { total: number; byWorker: Record<string, number> } {
  if (!workers) return { total: 0, byWorker: {} };
  const total = workers.reduce((sum, w) => sum + (w.exposedPorts?.length || 0), 0);
  const byWorker: Record<string, number> = {};
  workers.forEach(w => {
    byWorker[w.name] = w.exposedPorts?.length || 0;
  });
  return { total, byWorker };
}

/** Generate timeline events from worker state changes */
export function generateTimelineEvents(worker: WorkerResponse): { timestamp: string; phase: string; message?: string }[] {
  const now = new Date().toISOString();
  return [
    {
      timestamp: now,
      phase: worker.phase,
      message: worker.message || undefined,
    },
  ];
}

