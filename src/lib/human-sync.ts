// Human file-sync surface (upstream #1499, controller endpoints
// `/api/v1/humans/{name}/sync/status` and `/sync/manifest`).
//
// The dashboard is a read-only viewer here: the manifest PUT belongs to the
// file-sync client, so these helpers only normalize what the controller
// reports and decide how a degraded/unsupported read is presented. A missing
// manifest is a zero summary with 200; an older controller answers 404/405 —
// both render as an empty state, never as an error banner.

import type { HumanSyncStatus } from './agentteams-api';

export type HumanSyncEmptyReason = 'no-manifest' | 'unsupported';

export type HumanSyncView =
  | {
      kind: 'ready';
      generation: number;
      updatedAt: string;
      updatedBy: string;
      entries: number;
      tombstones: number;
      etag: string | null;
    }
  | { kind: 'empty'; reason: HumanSyncEmptyReason }
  | { kind: 'error'; message: string };

/**
 * Map a failed sync read to the empty-state it degrades to.
 * 404 = no manifest (or a controller without the route), 405 = the route
 * exists for another method but not GET (older controller) — both are
 * expected absences. Everything else is a real error.
 */
export function classifyHumanSyncError(status?: number): HumanSyncEmptyReason | 'error' {
  if (status === 404) return 'no-manifest';
  if (status === 405) return 'unsupported';
  return 'error';
}

/**
 * Normalize the controller's status summary. `generation`/`updatedAt` are
 * server-owned and only advance on an accepted manifest write, so a zero
 * pair means nothing has ever been synced — render the empty state even
 * though the controller answered 200 with an empty summary.
 */
export function mapHumanSyncStatus(status: HumanSyncStatus, etag: string | null): HumanSyncView {
  const generation = status.generation ?? 0;
  const updatedAt = status.updatedAt ?? '';
  if (!generation && !updatedAt) return { kind: 'empty', reason: 'no-manifest' };
  return {
    kind: 'ready',
    generation,
    updatedAt,
    updatedBy: status.updatedBy ?? '',
    entries: status.entries ?? 0,
    tombstones: status.tombstones ?? 0,
    etag,
  };
}

/** Display label for a manifest ETag; the storage ETag is shown verbatim. */
export function humanSyncEtagLabel(etag: string | null | undefined): string {
  return etag && etag.trim() ? etag : '—';
}
