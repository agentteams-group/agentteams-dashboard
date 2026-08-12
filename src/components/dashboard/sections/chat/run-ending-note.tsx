'use client';

import { AlertCircle, CheckCircle2, CircleSlash } from 'lucide-react';

export interface RunEndingPayload {
  kind: 'cancelled' | 'failed' | 'quiet';
  title: string;
}

/**
 * Run-ending block (任务书 §6.2.7): how a runtime closed the run.
 * cancelled → warning strip, failed → danger strip, quiet → one muted line.
 */
export function RunEndingNote({ payload }: { payload: RunEndingPayload }) {
  if (payload.kind === 'quiet') {
    return (
      <p className="my-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/70" data-testid="run-ending-quiet">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        {payload.title}
      </p>
    );
  }

  const isCancelled = payload.kind === 'cancelled';
  const Icon = isCancelled ? CircleSlash : AlertCircle;
  const tone = isCancelled
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
    : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400';

  return (
    <div
      role={isCancelled ? 'status' : 'alert'}
      data-testid={isCancelled ? 'run-ending-cancelled' : 'run-ending-failed'}
      className={`my-2 flex w-fit items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${tone}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {payload.title}
    </div>
  );
}
