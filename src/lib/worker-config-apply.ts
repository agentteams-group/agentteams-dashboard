// Worker runtime-config applied state (controller member-config surface).
//
// Non-QwenPaw runtimes (openclaw / hermes) expose their native config through
// the controller's member-config read end (`GET /api/members/{name}/config`).
// That projection carries the reconcile verdict (`applied`) and the list of
// keys whose writes only take effect after the worker process restarts
// (`pendingRestart`). This module is the client seam for the dashboard
// "restart to apply" action: read the verdict, and restart the worker through
// the controller end (`POST /api/v1/workers/{name}/restart`, upstream #1473).
//
// The controller never restarts a worker on its own — the restart is always an
// explicit user action, which is why this seam does not poll-and-restart.

import { ApiError, NetworkError, shortErrorMessage } from '@/lib/api-error';
import { apiUrl, extractErrorDetail } from '@/lib/api-base';

export type ConfigAppliedState =
  | 'applied'
  | 'pending'
  | 'unapplied'
  | 'applied-but-inactive'
  | (string & {});

export interface MemberConfigState {
  runtime: string;
  rev: string;
  values?: Record<string, unknown>;
  applied: ConfigAppliedState;
  pendingRestart?: string[];
  inactive?: string[];
}

export interface RestartWorkerResult {
  name: string;
  phase: string;
}

const configPath = (workerName: string) =>
  apiUrl(`/api/agentteams/members/${encodeURIComponent(workerName)}/config`);

const restartPath = (workerName: string) =>
  apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/runtime-config/restart`);

/** Read the worker's native-config reconcile state. */
export async function fetchMemberConfig(workerName: string): Promise<MemberConfigState> {
  let res: Response;
  try {
    res = await fetch(configPath(workerName), { cache: 'no-store' });
  } catch (err) {
    throw new NetworkError(configPath(workerName), err);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(detail, res.status, configPath(workerName));
  }
  return (await res.json()) as MemberConfigState;
}

/** True when a saved write has not been picked up by the running process. */
export function restartRequired(state: Pick<MemberConfigState, 'applied' | 'pendingRestart'>): boolean {
  if ((state.pendingRestart?.length ?? 0) > 0) return true;
  return state.applied === 'pending' || state.applied === 'unapplied';
}

/** Keys named by the controller as requiring a restart (deduplicated, ordered). */
export function pendingRestartKeys(state: Pick<MemberConfigState, 'pendingRestart'>): string[] {
  return Array.from(new Set(state.pendingRestart ?? []));
}

/**
 * Ask the controller to restart the worker so the process re-reads its config
 * (upstream #1473). The caller must keep this an explicit user action.
 */
export async function restartWorkerForConfig(workerName: string): Promise<RestartWorkerResult> {
  let res: Response;
  try {
    res = await fetch(restartPath(workerName), { method: 'POST' });
  } catch (err) {
    throw new NetworkError(restartPath(workerName), err);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(detail, res.status, restartPath(workerName));
  }
  return (await res.json()) as RestartWorkerResult;
}

/**
 * Actionable copy for a failed restart:
 *   404 — the worker disappeared between the read and the click;
 *   409 — a concurrent update (Kubernetes object conflict) lost the race;
 *   503 — the controller has no exec-capable worker backend (kube mode).
 */
export function describeRestartError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Worker 不存在或已被删除，请刷新列表后重试';
    if (err.status === 409) return 'Worker 正在被其他操作更新，请稍后重试';
    if (err.status === 503) return '当前部署模式不支持重启 Worker（需嵌入式模式）';
    return shortErrorMessage(err);
  }
  return err instanceof Error ? err.message : '重启失败';
}
