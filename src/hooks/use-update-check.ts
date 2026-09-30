'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { compareSemver } from '@/lib/version';

export { compareSemver };

export type UpdateCheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'error'; message: string }
  | { phase: 'uptodate' }
  | {
      phase: 'update-available';
      serverBuildId: string;
      builtAt: string | null;
      serverVersion: string;
      versionsEqual: boolean;
    }
  | { phase: 'upstream-available'; latestVersion: string }
  | { phase: 'updating'; baselineServerBuildId: string };

const PAGE_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'unknown';
const PAGE_BUILT_AT = process.env.NEXT_PUBLIC_BUILT_AT || null;
const PAGE_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

const GITHUB_RELEASE_URL =
  'https://api.github.com/repos/agentteams-group/agentteams-dashboard/releases/latest';
const CHECK_TIMEOUT_MS = 10_000;
const UPDATE_POLL_INTERVAL_MS = 2_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;

export interface UpdateCheckOptions {
  pollIntervalMs?: number;
  updateTimeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cache-busting reload. A plain location.reload() can keep hitting a
 * reverse-proxy/CDN-cached HTML document, so the page reloads straight back
 * onto the stale build (the "刷新了但构建号还是旧的" loop). Appending a
 * timestamp query param forces every intermediary to treat it as a fresh
 * URL and go to origin; the fresh HTML references the current build's
 * content-hashed chunks, which are also cache-cold by construction.
 */
function bustingReload(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('_b', String(Date.now()));
  window.location.replace(url.toString());
}

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Manual "检查更新" state machine (设置 → 更新). One click runs two
 * independent comparisons:
 *  - page build id vs the running server's build id → stale page detection
 *    (the image was redeployed but this tab never refreshed)
 *  - upstream GitHub release vs the build's package version → advisory hint
 *    that a newer image can be built from latest code
 *
 * updateContainer() goes one step further: it triggers the watchtower
 * sidecar (POST /api/self-update, admin-gated server-side) to pull the new
 * image and recreate the container, then polls /api/dashboard-build until
 * the running build actually changes, and reloads into the new version.
 * Transient fetch failures during the container restart are expected and
 * retried until the deadline.
 */
export function useUpdateCheck(options?: UpdateCheckOptions) {
  const pollIntervalMs = options?.pollIntervalMs ?? UPDATE_POLL_INTERVAL_MS;
  const updateTimeoutMs = options?.updateTimeoutMs ?? UPDATE_TIMEOUT_MS;

  const [state, setState] = useState<UpdateCheckState>({ phase: 'idle' });
  const inFlightRef = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const check = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState({ phase: 'checking' });
    try {
      const [buildRes, releaseRes] = await Promise.allSettled([
        fetchWithTimeout('/api/dashboard-build'),
        fetchWithTimeout(GITHUB_RELEASE_URL, {
          headers: { Accept: 'application/vnd.github+json' },
        }),
      ]);

      let buildState: UpdateCheckState;
      if (buildRes.status === 'fulfilled' && buildRes.value.ok) {
        const data = (await buildRes.value.json().catch(() => null)) as {
          buildId?: unknown;
          builtAt?: unknown;
          version?: unknown;
        } | null;
        const serverBuildId = typeof data?.buildId === 'string' ? data.buildId : 'unknown';
        const serverVersion = typeof data?.version === 'string' ? data.version : '';
        const builtAt = typeof data?.builtAt === 'string' ? data.builtAt : null;
        if (serverBuildId === 'unknown' && PAGE_BUILD_ID === 'unknown') {
          // Both sides unreadable: treat as current instead of false-positive.
          buildState = { phase: 'uptodate' };
        } else if (serverBuildId !== PAGE_BUILD_ID) {
          // Same version + different build id = the version was built more
          // than once (manual build vs CI) or multiple instances are running.
          // Surface it as a sync notice, not a "new version".
          buildState = {
            phase: 'update-available',
            serverBuildId,
            builtAt,
            serverVersion,
            versionsEqual: serverVersion !== '' && serverVersion === PAGE_VERSION,
          };
        } else {
          buildState = { phase: 'uptodate' };
        }
      } else {
        buildState = { phase: 'error', message: '无法获取服务器构建版本，请稍后重试' };
      }

      const upstreamVersion =
        releaseRes.status === 'fulfilled' && releaseRes.value.ok
          ? await releaseRes.value
              .json()
              .then((d: { tag_name?: unknown } | null) =>
                typeof d?.tag_name === 'string' ? d.tag_name : null
              )
              .catch(() => null)
          : null;

      inFlightRef.current = false;
      if (
        buildState.phase === 'uptodate' &&
        upstreamVersion &&
        compareSemver(upstreamVersion, PAGE_VERSION) > 0
      ) {
        setState({ phase: 'upstream-available', latestVersion: upstreamVersion });
      } else {
        setState(buildState);
      }
    } catch {
      inFlightRef.current = false;
      setState({ phase: 'error', message: '检查更新失败，请稍后重试' });
    }
  }, []);

  const applyUpdate = useCallback(() => {
    bustingReload();
  }, []);

  const updateContainer = useCallback(async () => {
    if (inFlightRef.current) return;
    const prev = stateRef.current;
    if (prev.phase !== 'update-available' && prev.phase !== 'upstream-available') {
      return;
    }
    const baselineServerBuildId =
      prev.phase === 'update-available' ? prev.serverBuildId : PAGE_BUILD_ID;
    inFlightRef.current = true;
    setState({ phase: 'updating', baselineServerBuildId });

    const run = async () => {
      try {
        // The route downloads + applies the bundle before responding — this
        // legitimately takes a minute or two, so no client timeout here.
        const res = await fetch('/api/self-update', { method: 'POST' });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
          const message = typeof body?.error === 'string' ? body.error : `更新触发失败（${res.status}）`;
          inFlightRef.current = false;
          setState({ phase: 'error', message });
          return;
        }
      } catch {
        inFlightRef.current = false;
        setState({ phase: 'error', message: '更新触发失败，请稍后重试' });
        return;
      }

      // Trigger accepted: watchtower pulls + recreates the container. The
      // dashboard goes down mid-poll (connection failures are normal) —
      // wait the running build id out, then land on the new version.
      const deadline = Date.now() + updateTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        try {
          const res = await fetch('/api/dashboard-build');
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as { buildId?: unknown } | null;
            const buildId = typeof data?.buildId === 'string' ? data.buildId : 'unknown';
            if (buildId !== 'unknown' && buildId !== baselineServerBuildId) {
              bustingReload();
              return;
            }
          }
        } catch {
          /* container restarting — keep polling */
        }
      }
      inFlightRef.current = false;
      setState({ phase: 'error', message: '更新超时：容器仍在旧版本运行，请检查 updater 容器后重试' });
    };

    // Returned for testability; the UI fire-and-forgets it.
    return run();
  }, [pollIntervalMs, updateTimeoutMs]);

  return {
    state,
    check,
    applyUpdate,
    updateContainer,
    pageBuildId: PAGE_BUILD_ID,
    pageBuiltAt: PAGE_BUILT_AT,
    pageVersion: PAGE_VERSION,
  };
}
