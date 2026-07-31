'use client';

import { useMemo } from 'react';
import { CheckCircle2, Loader2, AlertCircle, Square } from 'lucide-react';
import { STEP_TYPE_LABELS, STEP_STATUS_STYLE } from '@/lib/batch-workflow-types';
import type { ExecutionLogEntry } from '@/lib/batch-workflow-types';

interface ProgressBarProps {
  steps: ExecutionLogEntry[];
  totalSteps: number;
  currentStepIndex: number;
  status: 'running' | 'paused' | 'completed' | 'failed';
  onContinue?: () => void;
  onAbort?: () => void;
}

export function ProgressProgressBar({
  steps,
  totalSteps,
  currentStepIndex,
  status,
  onContinue,
  onAbort,
}: ProgressBarProps) {
  const progressPct = totalSteps > 0 ? Math.round((currentStepIndex / totalSteps) * 100) : 0;
  const hasFailed = steps.some((s) => s.status === 'failed');

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Top bar */}
      <div className="px-3 py-2 bg-muted/50 flex items-center gap-3 text-xs">
        <span className="font-medium flex-1 truncate">
          步骤 {currentStepIndex + 1} / {totalSteps}
        </span>
        <span className={`font-mono ${
          status === 'completed' ? 'text-emerald-500' :
          status === 'failed' ? 'text-red-500' :
          status === 'paused' ? 'text-amber-500' : 'text-blue-500'
        }`}>
          {progressPct}%
        </span>
        {(status === 'paused' || hasFailed) && (
          <div className="flex gap-1">
            {status === 'paused' && onContinue && (
              <button
                onClick={onContinue}
                className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 text-[10px] font-medium"
              >
                继续
              </button>
            )}
            {onAbort && (
              <button
                onClick={onAbort}
                className="px-2 py-0.5 rounded bg-red-500/20 text-red-500 hover:bg-red-500/30 text-[10px] font-medium"
              >
                中止
              </button>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted/30">
        <div
          className={`h-full transition-all duration-300 ${
            status === 'failed' ? 'bg-red-500' :
            status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Step indicators */}
      <div className="flex divide-x divide-border/30 overflow-x-auto">
        {Array.from({ length: totalSteps }, (_, i) => {
          const entry = steps.find((s) => s.stepOrder === i);
          const isActive = i === currentStepIndex && status === 'running';
          const isPast = i < currentStepIndex;
          return (
            <div
              key={i}
              className={`flex-1 min-w-fit px-2 py-1.5 flex items-center gap-1 text-[10px] ${
                entry?.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                isActive ? 'bg-blue-500/10 text-blue-500 font-medium' :
                entry?.status === 'completed' || isPast ? 'bg-emerald-500/10 text-emerald-500' :
                'text-muted-foreground'
              }`}
              title={`${STEP_TYPE_LABELS[entry?.stepType ?? 'select'] ?? '—'} · ${entry?.status ?? '等待中'}`}
            >
              {entry?.status === 'completed' || (isPast && !entry) ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" />
              ) : entry?.status === 'failed' ? (
                <AlertCircle className="h-3 w-3 shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <Square className="h-3 w-3 shrink-0 opacity-40" />
              )}
              <span className="truncate">{STEP_TYPE_LABELS[entry?.stepType ?? 'select'] ?? `S${i + 1}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
