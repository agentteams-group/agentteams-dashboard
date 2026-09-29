'use client';

import { useCallback, useRef, useState } from 'react';

export type UpdateCheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'error'; message: string }
  | { phase: 'uptodate' }
  | { phase: 'update-available'; serverBuildId: string; builtAt: string | null }
  | { phase: 'upstream-available'; latestVersion: string };

const PAGE_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'unknown';
const PAGE_BUILT_AT = process.env.NEXT_PUBLIC_BUILT_AT || null;
const PAGE_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

const GITHUB_RELEASE_URL =
  'https://api.github.com/repos/agentteams-group/agentteams-dashboard/releases/latest';
const CHECK_TIMEOUT_MS = 10_000;

/** Positive result means `a` is newer than `b`. Prerelease suffixes compare as 0. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  return fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Manual "检查更新" state machine (设置 → 更新). One click runs two
 * independent comparisons:
 *  - page build id vs the running server's build id → stale page detection
 *    (the image was redeployed but this tab never refreshed)
 *  - upstream GitHub release vs the build's package version → advisory hint
 *    that a newer image can be built from latest code
 */
export function useUpdateCheck() {
  const [state, setState] = useState<UpdateCheckState>({ phase: 'idle' });
  const inFlightRef = useRef(false);

  const check = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState({ phase: 'checking' });
    try {
      const [buildRes, releaseRes] = await Promise.allSettled([
        fetchWithTimeout('/api/dashboard-build'),
        fetchWithTimeout(GITHUB_RELEASE_URL, { Accept: 'application/vnd.github+json' }),
      ]);

      let buildState: UpdateCheckState;
      if (buildRes.status === 'fulfilled' && buildRes.value.ok) {
        const data = (await buildRes.value.json().catch(() => null)) as {
          buildId?: unknown;
          builtAt?: unknown;
        } | null;
        const serverBuildId = typeof data?.buildId === 'string' ? data.buildId : 'unknown';
        if (serverBuildId === 'unknown' && PAGE_BUILD_ID === 'unknown') {
          // Both sides unreadable: treat as current instead of false-positive.
          buildState = { phase: 'uptodate' };
        } else if (serverBuildId !== PAGE_BUILD_ID) {
          buildState = {
            phase: 'update-available',
            serverBuildId,
            builtAt: typeof data?.builtAt === 'string' ? data.builtAt : null,
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
    window.location.reload();
  }, []);

  return {
    state,
    check,
    applyUpdate,
    pageBuildId: PAGE_BUILD_ID,
    pageBuiltAt: PAGE_BUILT_AT,
    pageVersion: PAGE_VERSION,
  };
}
