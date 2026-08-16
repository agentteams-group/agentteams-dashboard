// Worker execution checkpoint read client.
//
//   GET /api/agentteams/workers/{name}/checkpoints/graph  → checkpoint graph
//   GET /api/agentteams/workers/{name}/checkpoints/status → auto flag + presence
//
// A worker on QwenPaw < 2.1 has no checkpoint router; the Controller
// translates the upstream 404 into a 502 whose message contains
// "requires QwenPaw 2.1" — surfaced here as CheckpointUnavailableError so
// UIs can render a placeholder instead of an error.
//
// Reuses the shared requestJson (./api-base) so the fetch mode and error
// shape (ApiError with upstream status) stay consistent with the other
// agentteams clients.

import { apiUrl, requestJson } from './api-base';
import { ApiError } from './api-error';

const WORKERS_URL = '/api/agentteams/workers';

export interface CheckpointNode {
  ref: string;
  kind: string; // auto | snap | pre-restore | sha
  session_key: string;
  name: string;
  commit: string;
  sha: string;
  timestamp_ms: number;
  subject: string;
  query: string | null;
  channel: string;
  is_head: boolean;
  user_id: string;
  session_title?: string;
}

export interface CheckpointGraphResponse {
  nodes: CheckpointNode[];
  sessions: unknown[];
  summary: {
    total: number;
    auto: number;
    snapshots: number;
    safety: number;
    heads: number;
  };
  truncated: boolean;
}

export interface CheckpointStatusResponse {
  auto_enabled: boolean;
  has_checkpoints: boolean;
  workspace_dir: string;
}

/**
 * Worker runs QwenPaw < 2.1 (Controller 502 degradation).
 * Extends the shared ApiError so `instanceof ApiError` + `status` keep
 * working for generic error handling; `name` is set explicitly so the
 * type survives cross-module aggregation / log serialization.
 */
export class CheckpointUnavailableError extends ApiError {
  constructor(message: string) {
    super(message, 502, 'worker-checkpoints');
    this.name = 'CheckpointUnavailableError';
  }
}

/**
 * 502 degradation contract (Controller, worker_checkpoints.go): the Controller
 * rewords the pre-2.1 upstream 404 into a 502 whose body message contains
 * this marker. The string is a stable cross-repo contract between the
 * Controller and this client — if the Controller rewords it (even to
 * "QwenPaw 2.1.0"), the "needs QwenPaw 2.1" placeholder silently breaks, so
 * any such Controller change must update this check in the same release.
 */
const CHECKPOINT_UNAVAILABLE_MARKER = 'requires QwenPaw 2.1';

/** Wrap the shared requestJson errors: map the contractual 502 to
 * CheckpointUnavailableError, pass everything else through untouched. */
async function fetchCheckpoint<T>(path: string, signal?: AbortSignal): Promise<T> {
  try {
    return await requestJson<T>(apiUrl(path), signal);
  } catch (e) {
    if (e instanceof ApiError && e.status === 502 && e.message.includes(CHECKPOINT_UNAVAILABLE_MARKER)) {
      throw new CheckpointUnavailableError(e.message);
    }
    throw e;
  }
}

export async function getWorkerCheckpointGraph(
  workerName: string,
  limit = 100,
  signal?: AbortSignal,
): Promise<CheckpointGraphResponse> {
  return fetchCheckpoint<CheckpointGraphResponse>(
    `${WORKERS_URL}/${encodeURIComponent(workerName)}/checkpoints/graph?limit=${limit}`,
    signal,
  );
}

export async function getWorkerCheckpointStatus(
  workerName: string,
  signal?: AbortSignal,
): Promise<CheckpointStatusResponse> {
  return fetchCheckpoint<CheckpointStatusResponse>(
    `${WORKERS_URL}/${encodeURIComponent(workerName)}/checkpoints/status`,
    signal,
  );
}
