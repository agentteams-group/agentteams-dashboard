import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  audit: vi.fn(),
  identity: vi.fn(),
  applyHotfix: vi.fn(),
}));

vi.mock('@/lib/dashboard-session', () => ({
  getSessionFromRequest: mocks.getSession,
}));
vi.mock('@/lib/audit-log', () => ({
  appendAuditEvent: mocks.audit,
}));
vi.mock('@/lib/server-auth', () => ({
  readServerIdentity: mocks.identity,
}));
vi.mock('@/lib/hotfix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hotfix')>();
  return {
    ...actual,
    selectHotfixAssets: vi.fn(),
    applyHotfix: mocks.applyHotfix,
  };
});

import { POST } from './route';
import { resetHotfixStateForTests, selectHotfixAssets } from '@/lib/hotfix';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/self-update', { method: 'POST' });
}

const RELEASE_WITH_BUNDLE = {
  tag_name: 'v1.2.5',
  assets: [
    {
      name: 'dashboard-hotfix-v1.2.5.tar.gz',
      browser_download_url: 'https://github.com/x/hotfix.tar.gz',
    },
  ],
};

vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.2.4');

describe('POST /api/self-update (hot patch)', () => {
  beforeEach(() => {
    resetHotfixStateForTests();
    vi.clearAllMocks();
    mocks.getSession.mockReturnValue({ level: 3 });
    mocks.identity.mockReturnValue({ name: 'admin', level: 3, sourceIp: '10.0.0.1' });
    mocks.audit.mockResolvedValue(undefined);
    (selectHotfixAssets as ReturnType<typeof vi.fn>).mockReturnValue({
      tag: 'v1.2.5',
      tarUrl: 'https://github.com/x/hotfix.tar.gz',
      sha256Url: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(RELEASE_WITH_BUNDLE), { status: 200 }))
    );
  });

  it('rejects non-admin sessions before touching anything', async () => {
    mocks.getSession.mockReturnValue({ level: 2 });
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(vi.mocked(fetch).mock.calls.length).toBe(0);
  });

  it('maps a GitHub failure to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
  });

  it('returns 404 when the latest release carries no hotfix bundle', async () => {
    (selectHotfixAssets as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });

  it('returns 409 when the release is not newer than the running build', async () => {
    (selectHotfixAssets as ReturnType<typeof vi.fn>).mockReturnValue({
      tag: 'v1.2.4',
      tarUrl: 'https://github.com/x/hotfix.tar.gz',
      sha256Url: null,
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
  });

  it('applies the patch, audits, and schedules a restart', async () => {
    mocks.applyHotfix.mockResolvedValue({ version: 'v1.2.5', buildId: 'new-build' });
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 'v1.2.5', buildId: 'new-build' });
    expect(mocks.applyHotfix).toHaveBeenCalledWith(
      expect.objectContaining({ release: expect.objectContaining({ tag: 'v1.2.5' }) })
    );
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(process.exit).mock.calls.length).toBeGreaterThanOrEqual(0);
    vi.mocked(process.exit).mockRestore();
  });

  it('maps apply failures to 502 with the user-presentable message', async () => {
    mocks.applyHotfix.mockRejectedValue(new Error('热更新包校验失败（sha256 不匹配），已中止'));
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('sha256');
  });
});
