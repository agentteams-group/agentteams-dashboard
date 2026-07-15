'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Bot, Users, Crown, UserCheck, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { WorkerResponse, TeamResponse, ManagerResponse, HumanResponse } from '@/lib/agentteams-api';

export interface SearchResult {
  entity: 'worker' | 'team' | 'manager' | 'human';
  name: string;
  subtitle: string;
  phase: string;
  section: string;
}

const ENTITY_ICONS = {
  worker: Bot,
  team: Users,
  manager: Crown,
  human: UserCheck,
} as const;

const ENTITY_COLORS = {
  worker: 'text-primary',
  team: 'text-emerald-500',
  manager: 'text-violet-500',
  human: 'text-cyan-500',
} as const;

const ENTITY_LABELS = {
  worker: 'Worker',
  team: '团队',
  manager: 'Manager',
  human: '用户',
} as const;

export function useGlobalSearch(
  query: string,
  workers?: WorkerResponse[],
  teams?: TeamResponse[],
  managers?: ManagerResponse[],
  humans?: HumanResponse[]
): SearchResult[] {
  return useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q || q.length < 2) return [];

    const results: SearchResult[] = [];

    // Search workers
    workers?.forEach((w) => {
      if (
        w.name.toLowerCase().includes(q) ||
        w.model.toLowerCase().includes(q) ||
        w.runtime.toLowerCase().includes(q) ||
        w.team?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'worker',
          name: w.name,
          subtitle: `${w.runtime} · ${w.model || '无模型'}`,
          phase: w.phase,
          section: 'workers',
        });
      }
    });

    // Search teams
    teams?.forEach((t) => {
      if (
        t.name.toLowerCase().includes(q) ||
        t.teamName?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'team',
          name: t.teamName || t.name,
          subtitle: `${t.readyWorkers}/${t.totalWorkers} Workers · ${t.leaderName}`,
          phase: t.phase,
          section: 'teams',
        });
      }
    });

    // Search managers
    managers?.forEach((m) => {
      if (
        m.name.toLowerCase().includes(q) ||
        m.model?.toLowerCase().includes(q) ||
        m.runtime?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'manager',
          name: m.name,
          subtitle: `${m.runtime || '-'} · ${m.model || '-'}`,
          phase: m.phase,
          section: 'managers',
        });
      }
    });

    // Search humans
    humans?.forEach((h) => {
      if (
        h.name.toLowerCase().includes(q) ||
        h.displayName?.toLowerCase().includes(q) ||
        h.email?.toLowerCase().includes(q) ||
        h.matrixUserID?.toLowerCase().includes(q)
      ) {
        results.push({
          entity: 'human',
          name: h.displayName || h.name,
          subtitle: h.email || h.matrixUserID || h.name,
          phase: h.phase,
          section: 'humans',
        });
      }
    });

    // Sort: exact name matches first, then by entity type
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === q ? 0 : 1;
      const bExact = b.name.toLowerCase() === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.entity.localeCompare(b.entity);
    });

    return results.slice(0, 20);
  }, [query, workers, teams, managers, humans]);
}

export function CommandPalette({
  results,
  onSelect,
  onClose,
}: {
  results: SearchResult[];
  onSelect: (_result: SearchResult) => void;
  onClose: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset selection when the result count changes (adjust state during render)
  const [prevResultCount, setPrevResultCount] = useState(results.length);
  if (prevResultCount !== results.length) {
    setPrevResultCount(results.length);
    setSelectedIdx(0);
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter' && results[selectedIdx]) {
        e.preventDefault();
        onSelect(results[selectedIdx]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, selectedIdx, onSelect, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (results.length === 0) return null;

  // Group by entity type
  const grouped = results.reduce(
    (acc, r) => {
      if (!acc[r.entity]) acc[r.entity] = [];
      acc[r.entity].push(r);
      return acc;
    },
    {} as Record<string, SearchResult[]>
  );

  let flatIdx = 0;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-xl max-h-80 overflow-y-auto custom-scrollbar z-50">
      <div ref={listRef} className="py-1">
        {(['worker', 'team', 'manager', 'human'] as const).map((entityType) => {
          const items = grouped[entityType];
          if (!items || items.length === 0) return null;
          const Icon = ENTITY_ICONS[entityType];
          return (
            <div key={entityType}>
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {ENTITY_LABELS[entityType]} ({items.length})
              </div>
              {items.map((result) => {
                const idx = flatIdx++;
                return (
                  <button
                    key={`${result.entity}-${result.name}`}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      idx === selectedIdx ? 'bg-accent' : 'hover:bg-accent/50'
                    }`}
                    onClick={() => onSelect(result)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${ENTITY_COLORS[result.entity]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{result.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {result.subtitle}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {result.phase}
                    </Badge>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
