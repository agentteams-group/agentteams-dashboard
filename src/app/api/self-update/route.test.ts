import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  audit: vi.fn(),
  identity: vi.fn(),
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

import { POST } from './route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/self-update', { method: 'POST' });
}

describe('POST /api/self-update', () => {
  beforeEach(() => {
    vi.stubEnv('DASHBOARD_UPDATER_URL', 'http://updater:8080');
    vi.stubEnv('DASHBOARD_UPDATER_TOKEN', 'shared-token');
    mocks.getSession.mockReturnValue({ level: 3 });
    mocks.identity.mockReturnValue({
      name: 'admin',
      level: 3,
      sourceIp: '10.0.0.1',
    });
    mocks.audit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('forwards the trigger to watchtower with the shared bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://updater:8080/v1/update',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer shared-token' },
      })
    );
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('rejects non-admin sessions before touching the updater', async () => {
    mocks.getSession.mockReturnValue({ level: 2 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rejects anonymous requests', async () => {
    mocks.getSession.mockReturnValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it('reports a missing updater configuration as 503', async () => {
    vi.stubEnv('DASHBOARD_UPDATER_TOKEN', '');
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });

  it('maps a watchtower failure to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 500 })));
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
  });

  it('maps an unreachable updater to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
  });
});
