import { NextRequest } from 'next/server';
import { getAuthToken, getControllerUrl, proxyToAgentTeams } from '@/app/api/agentteams/proxy-helper';

async function getControllerBaseUrl(): Promise<string> {
  return (
    process.env.AGENTTEAMS_CONTROLLER_URL ||
    process.env.AGENTTEAMS_API_URL ||
    'http://agentteams-controller:8090'
  );
}

async function controllerHeaders(): Promise<Record<string, string>> {
  const saToken = await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (saToken) headers.authorization = `Bearer ${saToken}`;
  return headers;
}

async function postWorkerAction(
  workerName: string,
  action: 'sleep' | 'wake' | 'ensure-ready',
  timeoutMs = 15000,
  request?: NextRequest,
): Promise<{ ok: boolean; status?: number; error?: string; phase?: string }> {
  const baseUrl = await getControllerBaseUrl();
  const headers = await controllerHeaders();
  const url = `${baseUrl}/api/v1/workers/${encodeURIComponent(workerName)}/${action}`;

  try {
    const res = request
      ? await proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(workerName)}/${action}`, { method: 'POST', forwardBody: false })
      : await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `${action} 失败 HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { phase?: string };
    return { ok: true, status: res.status, phase: body.phase };
  } catch (err) {
    return {
      ok: false,
      error: `${action} 异常: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

async function getWorkerPhase(workerName: string, request?: NextRequest): Promise<string | null> {
  const baseUrl = await getControllerBaseUrl();
  const headers = await controllerHeaders();
  const url = `${baseUrl}/api/v1/workers/${encodeURIComponent(workerName)}`;

  try {
    const res = request
      ? await proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(workerName)}`, { method: 'GET', forwardBody: false })
      : await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { phase?: string; state?: string } | null;
    return body?.phase ?? body?.state ?? null;
  } catch {
    return null;
  }
}

function isAwakePhase(phase: string | null | undefined): boolean {
  if (!phase) return false;
  const normalized = phase.toLowerCase();
  return normalized === 'running' || normalized === 'ready' || normalized === 'pending' || normalized === 'updating';
}

export interface RestartWorkerOptions {
  settleMs?: number;
  wakeRetryBaseMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULTS: Required<RestartWorkerOptions> = {
  settleMs: 2000,
  wakeRetryBaseMs: 1500,
  pollTimeoutMs: 30000,
  pollIntervalMs: 2000,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Force skill reload via sleep → wake, with retries and ensure-ready fallback.
 * Keeps poking wake/ensure-ready until the worker leaves Sleeping, so skill
 * distribution no longer leaves workers stranded in the sleeping state.
 */
export async function restartWorkerForSkillReload(
  workerName: string,
  options?: RestartWorkerOptions,
  request?: NextRequest,
): Promise<{ ok: boolean; error?: string; phase?: string | null }> {
  const { settleMs, wakeRetryBaseMs, pollTimeoutMs, pollIntervalMs } = {
    ...DEFAULTS,
    ...options,
  };

  await postWorkerAction(workerName, 'sleep', 15000, request);

  await wait(settleMs);

  let lastWakeError: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const wake = await postWorkerAction(workerName, 'wake', 15000, request);
    if (wake.ok) {
      lastWakeError = undefined;
      break;
    }
    lastWakeError = wake.error;
    await wait(wakeRetryBaseMs * (attempt + 1));
  }

  // ensure-ready is the strongest recovery path when wake is flaky.
  const ensure = await postWorkerAction(workerName, 'ensure-ready', 30000, request);
  if (!ensure.ok && lastWakeError) {
    const finalWake = await postWorkerAction(workerName, 'wake', 15000, request);
    if (!finalWake.ok) {
      return {
        ok: false,
        error: `重启后未能唤醒 Worker: ${lastWakeError}; ensure-ready: ${ensure.error}; final-wake: ${finalWake.error}`,
      };
    }
  }

  const deadline = Date.now() + pollTimeoutMs;
  let phase: string | null = null;
  while (Date.now() < deadline) {
    phase = await getWorkerPhase(workerName, request);
    if (isAwakePhase(phase)) {
      return { ok: true, phase };
    }
    if (phase && phase.toLowerCase() === 'sleeping') {
      await postWorkerAction(workerName, 'wake', 15000, request);
      await postWorkerAction(workerName, 'ensure-ready', 15000, request);
    }
    await wait(pollIntervalMs);
  }

  phase = await getWorkerPhase(workerName, request);
  if (isAwakePhase(phase)) {
    return { ok: true, phase };
  }

  return {
    ok: false,
    phase,
    error: `Worker 重启后仍未就绪 (phase=${phase ?? 'unknown'})`,
  };
}
