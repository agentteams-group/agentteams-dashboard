'use client';

import { useMemo } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, SkipForward } from 'lucide-react';
import { STEP_TYPE_LABELS, STEP_STATUS_STYLE } from '@/lib/batch-workflow-types';
import type { BatchExecutionResult } from '@/lib/batch-workflow-types';

export function ExecutionLog({ result }: { result: BatchExecutionResult }) {
  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const durationMs = result.completedAt - result.startedAt;

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden mt-2">
      <div className="px-3 py-2 bg-muted/50 flex items-center gap-3 text-xs">
        <span className="font-medium">{result.workflowName}</span>
        <ExecutionBadge status={result.status} />
        <span className="text-muted-foreground ml-auto">
          {formatTime(result.startedAt)} → {formatTime(result.completedAt)} · {(durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="divide-y divide-border/30">
        {result.steps.map((entry) => (
          <div key={entry.stepId} className="flex items-center gap-2 px-3 py-2 text-xs">
            <StepStatusIcon status={entry.status} />
            <span className="font-medium w-16">{STEP_TYPE_LABELS[entry.stepType]}</span>
            <span className="text-muted-foreground flex-1 truncate">
              Step {entry.stepOrder + 1}
              {entry.error && <span className="text-red-500 ml-1">· {entry.error}</span>}
            </span>
            {entry.affectedWorkers.length > 0 && (
              <span className="font-mono text-emerald-500">{entry.affectedWorkers.length} affected</span>
            )}
            <span className="text-muted-foreground">
              {(entry.completedAt - entry.startedAt) / 1000}s
            </span>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 bg-muted/30 text-[11px] text-muted-foreground flex gap-4">
        <span>总影响: <b className="text-emerald-500">{result.totalAffected}</b></span>
        <span>失败: <b className={result.totalFailed > 0 ? 'text-red-500' : 'text-emerald-500'}>{result.totalFailed}</b></span>
      </div>
    </div>
  );
}

function ExecutionBadge({ status }: { status: BatchExecutionResult['status'] }) {
  switch (status) {
    case 'completed':
      return <span className="flex items-center gap-1 text-emerald-500"><CheckCircle2 className="h-3 w-3" />完成</span>;
    case 'failed':
      return <span className="flex items-center gap-1 text-red-500"><XCircle className="h-3 w-3" />失败</span>;
    case 'paused':
      return <span className="flex items-center gap-1 text-amber-500"><SkipForward className="h-3 w-3" />已暂停</span>;
    case 'running':
      return <span className="flex items-center gap-1 text-blue-500"><Loader2 className="h-3 w-3 animate-spin" />运行中</span>;
    default:
      return <span className="text-muted-foreground">未开始</span>;
  }
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case 'failed': return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case 'skipped': return <SkipForward className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case 'running': return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}
