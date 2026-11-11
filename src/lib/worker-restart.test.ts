import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { restartWorkerForSkillReload } from '@/lib/worker-restart';

const proxy = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/agentteams/proxy-helper', () => ({
  proxyToAgentTeams: proxy,
  getControllerUrl: () => 'http://user-controller:8090',
  getAuthToken: vi.fn().mockResolvedValue('token'),
}));

const fast = { settleMs: 0, wakeRetryBaseMs: 1, pollTimeoutMs: 300, pollIntervalMs: 5 };

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('restartWorkerForSkillReload', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses the current authenticated request for every restart step', async () => {
    proxy.mockImplementation(() => jsonResponse({phase:'Running'}));
    const request=new NextRequest('http://dashboard.test/api/agentteams/workers/worker-1/restart',{method:'POST'});
    const result=await restartWorkerForSkillReload('worker-1',fast,request);
    expect(result.ok).toBe(true);
    expect(proxy).toHaveBeenCalledTimes(4);
    for(const call of proxy.mock.calls) expect(call[0]).toBe(request);
    expect(proxy).toHaveBeenCalledWith(request,'http://user-controller:8090','/api/v1/workers/worker-1/wake',expect.objectContaining({method:'POST'}));
  });

  it('returns ok when wake succeeds and phase becomes Running', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/sleep') || url.endsWith('/wake') || url.endsWith('/ensure-ready')) {
        return jsonResponse({ phase: 'Running' });
      }
      return jsonResponse({ phase: 'Running', state: 'Running' });
    }) as typeof fetch;

    const result = await restartWorkerForSkillReload('worker-1', fast);
    expect(result.ok).toBe(true);
    expect(result.phase).toBe('Running');
    expect(calls.some((u) => u.endsWith('/sleep'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/wake'))).toBe(true);
  });

  it('keeps poking wake until worker leaves Sleeping', async () => {
    let detailCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isAction =
        url.endsWith('/sleep') || url.endsWith('/wake') || url.endsWith('/ensure-ready');
      if (isAction) {
        return jsonResponse({});
      }
      detailCalls += 1;
      // Sleeping on first two detail polls, then Running.
      return jsonResponse({ phase: detailCalls <= 2 ? 'Sleeping' : 'Running' });
    }) as typeof fetch;

    const result = await restartWorkerForSkillReload('worker-1', {
      ...fast,
      pollTimeoutMs: 2000,
    });
    expect(result.ok).toBe(true);
    expect(result.phase).toBe('Running');
    expect(detailCalls).toBeGreaterThanOrEqual(3);
  });

  it('returns error with phase when worker remains Sleeping past the deadline', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/ensure-ready')) {
        return jsonResponse({}, 500);
      }
      return jsonResponse({ phase: 'Sleeping' });
    }) as typeof fetch;

    const result = await restartWorkerForSkillReload('worker-1', fast);
    expect(result.ok).toBe(false);
    expect(result.phase).toBe('Sleeping');
    expect(result.error).toContain('未就绪');
  });

  it('reports combined error when wake and ensure-ready both fail', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/sleep')) {
        return jsonResponse({});
      }
      return jsonResponse({}, 500);
    }) as typeof fetch;

    const result = await restartWorkerForSkillReload('worker-1', fast);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('重启后未能唤醒');
  });
});
