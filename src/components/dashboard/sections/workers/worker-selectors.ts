import type { WorkerResponse } from '@/lib/agentteams-api';
import type { SortKey } from './worker-types';

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

export interface WorkerGroup {
  /** 分组键：团队名，未归属为空串。 */
  team: string;
  workers: WorkerResponse[];
}

/**
 * 卡片视图按团队分组：具名团队按名称排序，未归属（无 team）放最后。
 * 空组不会出现（输入即已过滤后的列表）。
 */
export function groupWorkersByTeam(workers: WorkerResponse[]): WorkerGroup[] {
  const groups = new Map<string, WorkerResponse[]>();
  for (const worker of workers) {
    const team = worker.team?.trim() ?? '';
    const bucket = groups.get(team);
    if (bucket) bucket.push(worker);
    else groups.set(team, [worker]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    })
    .map(([team, members]) => ({ team, workers: members }));
}

export function computeRuntimeDist(workers: WorkerResponse[] | undefined): Record<string, number> {
  const dist: Record<string, number> = {};
  workers?.forEach((w) => {
    dist[w.runtime] = (dist[w.runtime] || 0) + 1;
  });
  return dist;
}
