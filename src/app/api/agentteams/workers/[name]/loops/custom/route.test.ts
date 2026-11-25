import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxyToAgentTeams = vi.fn();
const getControllerUrl = vi.fn((..._a: unknown[]) => 'http://agentteams-controller:8090');
const enforceServerSideRbac = vi.fn();

vi.mock('../../../../proxy-helper', () => ({
  proxyToAgentTeams: (...a: unknown[]) => proxyToAgentTeams(...a),
  getControllerUrl: (...a: unknown[]) => getControllerUrl(...a),
}));
vi.mock('@/lib/server-auth', () => ({
  enforceServerSideRbac: (...a: unknown[]) => enforceServerSideRbac(...a),
}));

import { GET, POST } from './route';

function callGET(name: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/loops/custom`,
    { method: 'GET' },
  );
  return GET(req, { params: Promise.resolve({ name }) });
}

function callPOST(name: string, body = '{"id":"m1"}') {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/loops/custom`,
    { method: 'POST', body, headers: { 'content-type': 'application/json' } },
  );
  return POST(req, { params: Promise.resolve({ name }) });
}

describe('/workers/[name]/loops/custom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceServerSideRbac.mockResolvedValue(null);
  });

  it('GET 透传自定义 loop 列表', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json([]));
    const res = await callGET('worker-1');
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/loops/custom',
      { forwardBody: false, method: 'GET' },
    );
  });

  it('POST：RBAC 拒绝 → 直接返回，不透传', async () => {
    enforceServerSideRbac.mockResolvedValue(
      NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    );
    const res = await callPOST('worker-1');
    expect(res.status).toBe(403);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('POST 透传完整 mode 对象', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ id: 'm1' }, { status: 201 }));
    const res = await callPOST('worker-1');
    expect(res.status).toBe(201);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/loops/custom',
      { forwardBody: true, method: 'POST' },
    );
  });
});
