import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { compareSemver } from './use-update-check';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('compareSemver', () => {
  it('orders releases and tolerates the v prefix / prerelease suffix', () => {
    expect(compareSemver('v1.3.0', 'v1.2.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.4', '1.3.0')).toBeLessThan(0);
    expect(compareSemver('v1.2.4', '1.2.4')).toBe(0);
    // Advisory only: a prerelease of the same numeric version is not "newer".
    expect(compareSemver('v1.2.4-beta', 'v1.2.4')).toBe(0);
  });
});

describe('useUpdateCheck', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'page-build');
    vi.stubEnv('NEXT_PUBLIC_BUILT_AT', '2026-09-28T10:00:00Z');
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.2.4');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    cleanup();
  });

  it('flags a stale page when the server build id differs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          buildId: 'server-build',
          builtAt: '2026-09-29T08:03:00Z',
          version: '2.0.0',
        })
      )
      .mockRejectedValueOnce(new Error('github unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() => useUpdateCheck());
    await act(async () => {
      await result.current.check();
    });

    expect(result.current.state).toEqual({
      phase: 'update-available',
      serverBuildId: 'server-build',
      builtAt: '2026-09-29T08:03:00Z',
      serverVersion: '2.0.0',
      versionsEqual: false,
    });
  });

  it('marks same-version build mismatches as versionsEqual (sync notice, not new version)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.2.5-beta.1');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          buildId: 'other-build-same-version',
          builtAt: null,
          version: '1.2.5-beta.1',
        })
      )
      .mockRejectedValueOnce(new Error('github unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() => useUpdateCheck());
    await act(async () => {
      await result.current.check();
    });

    expect(result.current.state).toEqual({
      phase: 'update-available',
      serverBuildId: 'other-build-same-version',
      builtAt: null,
      serverVersion: '1.2.5-beta.1',
      versionsEqual: true,
    });
  });

  it('reports uptodate when page and server builds match', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ buildId: 'page-build', builtAt: null }))
      .mockRejectedValueOnce(new Error('github unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() => useUpdateCheck());
    await act(async () => {
      await result.current.check();
    });

    expect(result.current.state).toEqual({ phase: 'uptodate' });
  });

  it('treats unknown page+server build ids as current (no false positive)', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'unknown');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ buildId: 'unknown', builtAt: null }))
      .mockRejectedValueOnce(new Error('github unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() => useUpdateCheck());
    await act(async () => {
      await result.current.check();
    });

    expect(result.current.state).toEqual({ phase: 'uptodate' });
  });

  it('surfaces a newer upstream release when the deployment itself is current', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ buildId: 'page-build', builtAt: null }))
      .mockResolvedValueOnce(jsonResponse({ tag_name: 'v2.0.0' }));
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() => useUpdateCheck());
    await act(async () => {
      await result.current.check();
    });

    expect(result.current.state).toEqual({
      phase: 'upstream-available',
      latestVersion: 'v2.0.0',
    });
  });

  it('errors with a retry hint when the server build endpoint fails', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() => useUpdateCheck());
    await act(async () => {
      await result.current.check();
    });

    expect(result.current.state).toEqual({
      phase: 'error',
      message: '无法获取服务器构建版本，请稍后重试',
    });
  });

  it('applyUpdate reloads the page', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload },
    });

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() => useUpdateCheck());
    act(() => {
      result.current.applyUpdate();
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('updateContainer triggers the updater and reloads once the build changes', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload },
    });

    let buildPolls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/dashboard-build')) {
        buildPolls += 1;
        // First call is the check itself (running build unchanged); the
        // update polls then observe the container coming back on a new build.
        const buildId = buildPolls === 1 ? 'page-build' : 'new-build';
        return jsonResponse({ buildId, builtAt: null });
      }
      if (url.includes('releases/latest')) {
        return jsonResponse({ tag_name: 'v2.0.0' });
      }
      if (url.endsWith('/api/self-update')) {
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() =>
      useUpdateCheck({ pollIntervalMs: 5, updateTimeoutMs: 5_000 })
    );

    await act(async () => {
      await result.current.check();
    });
    expect(result.current.state).toEqual({ phase: 'upstream-available', latestVersion: 'v2.0.0' });

    await act(async () => {
      await result.current.updateContainer();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/self-update',
      expect.objectContaining({ method: 'POST' })
    );
    expect(buildPolls).toBeGreaterThanOrEqual(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('updateContainer surfaces updater-side errors without polling', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/dashboard-build')) {
        return jsonResponse({ buildId: 'page-build', builtAt: null });
      }
      if (url.includes('releases/latest')) {
        return jsonResponse({ tag_name: 'v2.0.0' });
      }
      if (url.endsWith('/api/self-update')) {
        return new Response(JSON.stringify({ error: '更新器未配置' }), { status: 503 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() =>
      useUpdateCheck({ pollIntervalMs: 5, updateTimeoutMs: 5_000 })
    );

    await act(async () => {
      await result.current.check();
    });
    await act(async () => {
      await result.current.updateContainer();
    });

    expect(result.current.state).toEqual({ phase: 'error', message: '更新器未配置' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('updateContainer reports a timeout when the running build never changes', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/dashboard-build')) {
        return jsonResponse({ buildId: 'page-build', builtAt: null });
      }
      if (url.includes('releases/latest')) {
        return jsonResponse({ tag_name: 'v2.0.0' });
      }
      if (url.endsWith('/api/self-update')) {
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useUpdateCheck } = await import('./use-update-check');
    const { result } = renderHook(() =>
      useUpdateCheck({ pollIntervalMs: 5, updateTimeoutMs: 40 })
    );

    await act(async () => {
      await result.current.check();
    });
    await act(async () => {
      await result.current.updateContainer();
    });

    expect(result.current.state).toEqual({
      phase: 'error',
      message: '更新超时：容器仍在旧版本运行，请检查 updater 容器后重试',
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
