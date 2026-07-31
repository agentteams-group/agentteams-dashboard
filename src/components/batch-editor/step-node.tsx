'use client';

import { DragEvent } from 'react';
import {
  Filter,
  CheckCircle2,
  Play,
  Bell,
  Trash2,
  ArrowDown,
  ArrowUp,
  GripVertical,
} from 'lucide-react';
import type { BatchStep, BatchStepType, StepStatus } from '@/lib/batch-workflow-types';
import { STEP_TYPE_LABELS, STEP_STATUS_STYLE, ACTION_VERBS } from '@/lib/batch-workflow-types';

interface StepNodeProps {
  step: BatchStep;
  index: number;
  total: number;
  selected: boolean;
  onDragStart: (e: DragEvent, index: number) => void;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

export function StepNode({
  step,
  index,
  total,
  selected,
  onDragStart,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
}: StepNodeProps) {
  const type = step.type;
  const statusStyle = STEP_STATUS_STYLE[step.status ?? 'pending'];

  const actionVerbLabel = type === 'action'
    ? (ACTION_VERBS.find((v) => v.value === (step.config as { verb: string }).verb)?.label ?? '—')
    : null;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onClick={onSelect}
      className={[
        'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all',
        selected
          ? 'border-emerald-500 bg-emerald-500/10 shadow-sm'
          : 'border-border/50 bg-card hover:border-border',
        statusStyle.bg,
      ].join(' ')}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />

      {/* Step icon */}
      <StepIcon type={type} />

      {/* Step label */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium ${statusStyle.text}`}>
          {STEP_TYPE_LABELS[type]}
          {actionVerbLabel && <span className="ml-1 text-muted-foreground">· {actionVerbLabel}</span>}
        </p>
        {step.affectedCount !== undefined && (
          <p className="text-[10px] text-muted-foreground">{step.affectedCount} 个 Worker</p>
        )}
      </div>

      {/* Status badge */}
      {step.status && step.status !== 'pending' && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${statusStyle.text}`}>
          {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : '…'}
        </span>
      )}

      {/* Move buttons */}
      <div className="flex gap-0.5 shrink-0">
        <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={index === 0}
          className="p-1 rounded hover:bg-muted disabled:opacity-30">
          <ArrowUp className="h-3 w-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={index === total - 1}
          className="p-1 rounded hover:bg-muted disabled:opacity-30">
          <ArrowDown className="h-3 w-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded hover:bg-red-500/10 text-red-500">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function StepIcon({ type }: { type: BatchStepType }) {
  switch (type) {
    case 'select':   return <Filter className="h-4 w-4 text-blue-500" />;
    case 'validate': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'action':   return <Play className="h-4 w-4 text-amber-500" />;
    case 'notify':   return <Bell className="h-4 w-4 text-violet-500" />;
  }
}
