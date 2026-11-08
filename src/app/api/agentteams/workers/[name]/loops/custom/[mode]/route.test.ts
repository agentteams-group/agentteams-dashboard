import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxyToAgentTeams = vi.fn();
const getControllerUrl = vi.fn((..._a: unknown[]) => 'http://agentteams-controller:8090');
const enforceServerSideRbac = vi.fn();

vi.mock('../../../../../proxy-helper', () => ({
  proxyToAgentTeams: (...a: unknown[]) => proxyToAgentTeams(...a),
  getControllerUrl: (...a: unknown[]) => getControllerUrl(...a),
}));
vi.mock('@/lib/server-auth', () => ({
  enforceServerSideRbac: (...a: unknown[]) => enforceServerSideRbac(...a),
}));

import { PUT, DELETE } from './route';

function call(method: 'PUT' | 'DELETE', name: string, mode: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/loops/custom/${encodeURIComponent(mode)}`,
    {
      method,
      ...(method === 'PUT'
        ? { body: JSON.stringify({ id: mode }), headers: { 'content-type': 'application/json' } }
        : {}),
    },
  );
  return method === 'PUT'
    ? PUT(req, { params: Promise.resolve({ name, mode }) })
    : DELETE(req, { params: Promise.resolve({ name, mode }) });
}

describe('/workers/[name]/loops/custom/[mode]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceServerSideRbac.mockResolvedValue(null);
  });

  it('非法 mode → 400，不透传', async () => {
    const res = await call('DELETE', 'worker-1', 'bad/mode');
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('PUT 透传整块替换', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ id: 'm1' }));
    const res = await call('PUT', 'worker-1', 'm1');
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/loops/custom/m1',
      { forwardBody: true, method: 'PUT' },
    );
  });

  it('DELETE：RBAC 拒绝 → 直接返回', async () => {
    enforceServerSideRbac.mockResolvedValue(
      NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    );
    const res = await call('DELETE', 'worker-1', 'm1');
    expect(res.status).toBe(403);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('DELETE 透传 204', async () => {
    proxyToAgentTeams.mockResolvedValue(new NextResponse(null, { status: 204 }));
    const res = await call('DELETE', 'worker-1', 'm1');
    expect(res.status).toBe(204);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/loops/custom/m1',
      { forwardBody: false, method: 'DELETE' },
    );
  });
});
