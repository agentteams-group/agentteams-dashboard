'use client';

import { useEffect, useState } from 'react';
import { useSyncDiagnostics, syncStatusOf } from '@/lib/matrix-sync-buffer';

function agoLabel(ts: number, now: number): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s 前`;
  if (s < 3600) return `${Math.floor(s / 60)}min 前`;
  return `${Math.floor(s / 3600)}h 前`;
}

/**
 * Live /sync health chip for the chat header.
 *
 * This is the D1 diagnostic surface: when chat "doesn't update", the chip
 * tells you *which* layer is broken —
 *  - `实时`   = /sync batches arriving (server + connection healthy);
 *  - `延迟`   = batches completed but > 45s ago (loop stalled / slow net);
 *  - `断开`   = consecutive /sync failures (auth, homeserver, network) with
 *               the last error in the tooltip;
 *  - `连接中` = no batch yet since page load.
 * The logged-in account itself is visible in the ChatAuthBadge next door —
 * together they answer "is the dashboard even logged in as the account that
 * is a member of these rooms?".
 */
export function SyncStatusChip() {
  const d = useSyncDiagnostics();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const status = syncStatusOf(d, now);
  const dot =
    status === 'live'
      ? 'bg-emerald-500'
      : status === 'stale'
        ? 'bg-amber-500'
        : status === 'error'
          ? 'bg-red-500'
          : 'bg-muted-foreground/40';
  const label =
    status === 'live' ? '实时' : status === 'stale' ? '延迟' : status === 'error' ? '断开' : '连接中';

  const title = [
    `最后同步：${agoLabel(d.lastSyncAt, now)}`,
    `最后事件：${agoLabel(d.lastEventTs, now)}`,
    d.error ? `错误：${d.error}（连续 ${d.failCount} 次）` : '错误：无',
  ].join('\n');

  return (
    <span
      className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-border text-xs text-muted-foreground select-none"
      title={title}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
