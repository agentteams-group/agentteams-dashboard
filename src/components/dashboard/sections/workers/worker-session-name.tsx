'use client';

import { WorkerSessionDot } from '@/components/worker-session-dot';
import { useWorkerSessionState } from '@/hooks/use-worker-session-state';
import { workerDisplayName } from '@/lib/worker-display-name';

/**
 * Worker name + session dot (A17). Row-level component (hooks cannot
 * live in the list map callback) — shared by the card and table views.
 * The dot sits next to the name; the leading StatusDot (CR phase)
 * stays untouched — process-level vs session-level, two axes (v1.51
 * decision b).
 */
export function WorkerSessionName({
  worker,
  className = '',
}: {
  worker: { name: string; identity?: string; matrixUserID?: string; roomID?: string; phase?: string };
  className?: string;
}) {
  const state = useWorkerSessionState(worker);
  const displayName = workerDisplayName(worker);
  // A worker without a Matrix identity has no session to show — name
  // only, no dot (a gray "no task" dot would be a lie).
  if (!worker.matrixUserID) {
    return <span className={`font-medium truncate ${className}`}>{displayName}</span>;
  }
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="font-medium truncate">{displayName}</span>
      <WorkerSessionDot state={state} />
    </span>
  );
}
