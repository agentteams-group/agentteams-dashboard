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
        jsonResponse({ buildId: 'server-build', builtAt: '2026-09-29T08:03:00Z' })
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
});
