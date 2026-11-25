import type { HumanResponse } from '@/lib/agentteams-api';
import type { SortKey } from './human-types';

export function isManagedHuman(human: HumanResponse): boolean {
  return !human.systemAdmin;
}

export function filterHumans(
  humans: HumanResponse[] | undefined,
  searchQuery: string,
): HumanResponse[] {
  if (!humans) return [];
  if (!searchQuery) return humans;
  const q = searchQuery.toLowerCase();
  return humans.filter(
    (h) =>
      (h.name || '').toLowerCase().includes(q) ||
      (h.displayName || '').toLowerCase().includes(q) ||
      (h.email || '').toLowerCase().includes(q) ||
      (h.matrixUserID || '').toLowerCase().includes(q),
  );
}

export function sortHumans(humans: HumanResponse[], sortKey: SortKey): HumanResponse[] {
  const sorted = [...humans];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return (a.name || '').localeCompare(b.name || '');
      case 'phase':
        return (a.phase || '').localeCompare(b.phase || '');
      default:
        return 0;
    }
  });
  return sorted;
}

export function computePhaseStats(humans: HumanResponse[] | undefined): Record<string, number> {
  const stats: Record<string, number> = {};
  humans?.forEach((h) => {
    stats[h.phase] = (stats[h.phase] || 0) + 1;
  });
  return stats;
}
