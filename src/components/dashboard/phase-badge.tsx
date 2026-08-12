'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  WORKER_PHASE_BADGE_CLASSES,
  WORKER_PHASE_LABELS,
  TEAM_PHASE_BADGE_CLASSES,
  TEAM_PHASE_LABELS,
  MANAGER_PHASE_BADGE_CLASSES,
  MANAGER_PHASE_LABELS,
  HUMAN_PHASE_BADGE_CLASSES,
  HUMAN_PHASE_LABELS,
  RUNTIME_LABELS,
} from '@/lib/phase-colors';
import { getRuntimeMeta } from '@/lib/runtime-meta';

type ResourceKind = 'worker' | 'team' | 'manager' | 'human';

const PHASE_LABEL_MAPS = {
  worker: WORKER_PHASE_LABELS,
  team: TEAM_PHASE_LABELS,
  manager: MANAGER_PHASE_LABELS,
  human: HUMAN_PHASE_LABELS,
} as const;

const PHASE_CLASS_MAPS = {
  worker: WORKER_PHASE_BADGE_CLASSES,
  team: TEAM_PHASE_BADGE_CLASSES,
  manager: MANAGER_PHASE_BADGE_CLASSES,
  human: HUMAN_PHASE_BADGE_CLASSES,
} as const;

export interface PhaseBadgeProps {
  kind: ResourceKind;
  phase: string;
  className?: string;
}

export function PhaseBadge({ kind, phase, className }: PhaseBadgeProps) {
  const labelMap = PHASE_LABEL_MAPS[kind] as Record<string, string>;
  const classMap = PHASE_CLASS_MAPS[kind] as Record<string, string>;
  return (
    <Badge className={`${classMap[phase] || ''} ${className || ''}`.trim()} variant="secondary">
      {labelMap[phase] || phase}
    </Badge>
  );
}

export interface RuntimeBadgeProps {
  runtime: string;
  className?: string;
  /** 'sm' renders a compact corner badge (used on Chat thinking/tool cards). */
  size?: 'default' | 'sm';
  /** Show the runtime capability note on hover. */
  withTooltip?: boolean;
}

export function RuntimeBadge({ runtime, className, size = 'default', withTooltip = false }: RuntimeBadgeProps) {
  const meta = getRuntimeMeta(runtime);
  const label = RUNTIME_LABELS[runtime] || runtime;
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0 gap-0.5' : 'text-xs';
  const Icon = meta?.icon;

  const badge = (
    <Badge variant="outline" className={`${meta?.badgeClass ?? ''} ${sizeClass} ${className ?? ''}`.trim()}>
      {Icon && <Icon className={size === 'sm' ? 'w-2.5 h-2.5' : undefined} aria-hidden="true" />}
      {label}
    </Badge>
  );

  if (!withTooltip || !meta) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{meta.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
