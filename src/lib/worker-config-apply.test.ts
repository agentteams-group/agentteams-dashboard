import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeRestartError,
  fetchMemberConfig,
  pendingRestartKeys,
  restartRequired,
  restartWorkerForConfig,
} from '@/lib/worker-config-apply';
import { ApiError } from '@/lib/api-error';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('restartRequired', () => {
  it('is true when the controller reports pendingRestart keys', () => {
    expect(restartRequired({ applied: 'applied', pendingRestart: ['gateway.port'] })).toBe(true);
  });

  it('is true for the pending / unapplied reconcile verdicts', () => {
    expect(restartRequired({ applied: 'pending', pendingRestart: [] })).toBe(true);
    expect(restartRequired({ applied: 'unapplied' })).toBe(true);
  });

  it('is false when the write is applied and no restart keys are pending', () => {
    expect(restartRequired({ applied: 'applied', pendingRestart: [] })).toBe(false);
    expect(restartRequired({ applied: 'applied' })).toBe(false);
  });

  it('does not treat applied-but-inactive as a restart case', () => {
    expect(restartRequired({ applied: 'applied-but-inactive', pendingRestart: [] })).toBe(false);
  });
});

describe('pendingRestartKeys', () => {
  it('deduplicates and preserves order', () => {
    expect(pendingRestartKeys({ pendingRestart: ['b', 'a', 'b'] })).toEqual(['b', 'a']);
    expect(pendingRestartKeys({})).toEqual([]);
  });
});

describe('member-config apply seam', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('reads the member config through the dashboard proxy', async () => {
    const state = {
      runtime: 'openclaw',
      rev: 'abc',
      values: {},
      applied: 'pending',
      pendingRestart: ['gateway.port'],
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(state));

    await expect(fetchMemberConfig('w1')).resolves.toEqual(state);
    expect(fetch).toHaveBeenCalledWith(
      '/api/agentteams/members/w1/config/',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('surfaces a controller 409 (runtime_unknown) as an ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'runtime_unknown' }, 409));

    await expect(fetchMemberConfig('w1')).rejects.toMatchObject({
      status: 409,
      endpoint: '/api/agentteams/members/w1/config/',
    });
  });

  it('restarts through the runtime-config restart proxy', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ name: 'w1', phase: 'Running' }));

    await expect(restartWorkerForConfig('w1')).resolves.toEqual({ name: 'w1', phase: 'Running' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/agentteams/workers/w1/runtime-config/restart/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('turns 404 / 409 restarts into actionable copy', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'worker not found' }, 404));
    const notFound = await restartWorkerForConfig('ghost').catch((e: unknown) => e);
    expect(notFound).toBeInstanceOf(ApiError);
    expect(describeRestartError(notFound)).toContain('不存在或已被删除');

    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'conflict' }, 409));
    const conflict = await restartWorkerForConfig('w1').catch((e: unknown) => e);
    expect(describeRestartError(conflict)).toContain('正在被其他操作更新');
  });
});
