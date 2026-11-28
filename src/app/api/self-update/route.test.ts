import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  audit: vi.fn(),
  identity: vi.fn(),
  applyHotfix: vi.fn(),
}));

vi.mock('@/lib/dashboard-session', () => ({ getSessionFromRequest: mocks.getSession }));
vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: mocks.audit }));
vi.mock('@/lib/server-auth', () => ({ readServerIdentity: mocks.identity }));
vi.mock('@/lib/hotfix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hotfix')>();
  return { ...actual, selectHotfixAssets: vi.fn(), applyHotfix: mocks.applyHotfix };
});

import { POST } from './route';
import { resetHotfixStateForTests, selectHotfixAssets } from '@/lib/hotfix';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/self-update', { method: 'POST' });
}

const RELEASE_WITH_BUNDLE = {
  tag_name: 'v1.2.5',
  assets: [
    { name: 'dashboard-hotfix-v1.2.5.tar.gz', browser_download_url: 'https://github.com/x/hotfix.tar.gz' },
    { name: 'dashboard-hotfix-v1.2.5.tar.gz.sha256', browser_download_url: 'https://github.com/x/hotfix.tar.gz.sha256' },
  ],
};

describe('POST /api/self-update (hot patch)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHotfixStateForTests();
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.2.4');
    mocks.getSession.mockReturnValue({ level: 3 });
    mocks.identity.mockReturnValue({ name: 'admin', level: 3, sourceIp: '10.0.0.1' });
    mocks.audit.mockResolvedValue(undefined);
    (selectHotfixAssets as ReturnType<typeof vi.fn>).mockReturnValue({
      tag: 'v1.2.5',
      tarUrl: 'https://github.com/x/hotfix.tar.gz',
      sha256Url: 'https://github.com/x/hotfix.tar.gz.sha256',
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(RELEASE_WITH_BUNDLE), { status: 200 })));
    // These spies are mandatory: a regression must never signal the test runner.
    vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects non-admin sessions before touching anything', async () => {
    mocks.getSession.mockReturnValue({ level: 2 });
    expect((await POST(makeRequest())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.applyHotfix).not.toHaveBeenCalled();
  });

  it('maps a GitHub failure to 502 without scheduling a restart', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect((await POST(makeRequest())).status).toBe(502);
    expect(process.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns 404 when the latest release lacks the bundle/checksum pair', async () => {
    (selectHotfixAssets as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect((await POST(makeRequest())).status).toBe(404);
    expect(mocks.applyHotfix).not.toHaveBeenCalled();
  });

  it('returns 409 when the release is not newer than the running build', async () => {
    (selectHotfixAssets as ReturnType<typeof vi.fn>).mockReturnValue({
      tag: 'v1.2.4', tarUrl: 'https://github.com/x/hotfix.tar.gz', sha256Url: 'https://github.com/x/hotfix.tar.gz.sha256',
    });
    expect((await POST(makeRequest())).status).toBe(409);
    expect(mocks.applyHotfix).not.toHaveBeenCalled();
  });

  it('audits success, sends SIGTERM at 800ms, then SIGKILL and exits at 2300ms', async () => {
    mocks.applyHotfix.mockResolvedValue({ version: 'v1.2.5', buildId: 'new-build', previousBuildId: 'old-build' });
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 'v1.2.5', buildId: 'new-build' });
    expect(mocks.applyHotfix).toHaveBeenCalledWith({
      release: expect.objectContaining({ tag: 'v1.2.5', sha256Url: 'https://github.com/x/hotfix.tar.gz.sha256' }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'admin', action: 'self-update', severity: 'warning',
      details: expect.stringContaining('new-build'),
    }));
    expect((await POST(makeRequest())).status).toBe(409);
    expect(mocks.applyHotfix).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(799);
    expect(process.kill).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(process.kill).toHaveBeenNthCalledWith(1, process.pid, 'SIGTERM');
    expect(process.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1499);
    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(process.kill).toHaveBeenNthCalledWith(2, process.pid, 'SIGKILL');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('audits apply failures, releases the claim, and never schedules signals', async () => {
    mocks.applyHotfix.mockRejectedValue(new Error('热更新包校验失败（sha256 不匹配），已中止'));
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('sha256');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'admin', action: 'self-update-failed', severity: 'error',
      details: expect.stringContaining('sha256'),
    }));
    await vi.advanceTimersByTimeAsync(2300);
    expect(process.kill).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    mocks.applyHotfix.mockResolvedValue({ version: 'v1.2.5', buildId: 'new-build' });
    expect((await POST(makeRequest())).status).toBe(200);
  });

  it('rejects an overlapping run while the first patch is in flight', async () => {
    let finish: ((_value: { version: string; buildId: string }) => void) | undefined;
    mocks.applyHotfix.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = POST(makeRequest());
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.applyHotfix).toHaveBeenCalledTimes(1);
    expect((await POST(makeRequest())).status).toBe(409);
    finish?.({ version: 'v1.2.5', buildId: 'new-build' });
    expect((await first).status).toBe(200);
  });
});
