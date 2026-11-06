import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxyToAgentTeams = vi.fn();
const getControllerUrl = vi.fn((..._a: unknown[]) => 'http://agentteams-controller:8090');
const enforceServerSideRbac = vi.fn();

vi.mock('../../../proxy-helper', () => ({
  proxyToAgentTeams: (...a: unknown[]) => proxyToAgentTeams(...a),
  getControllerUrl: (...a: unknown[]) => getControllerUrl(...a),
}));
vi.mock('@/lib/server-auth', () => ({
  enforceServerSideRbac: (...a: unknown[]) => enforceServerSideRbac(...a),
}));

import { GET, PUT } from './route';

function callGET(name: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/runtime-config`,
    { method: 'GET' },
  );
  return GET(req, { params: Promise.resolve({ name }) });
}

function callPUT(name: string, body?: string, ifMatch?: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/runtime-config`,
    { method: 'PUT', body, headers: { 'content-type': 'application/json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) } },
  );
  return PUT(req, { params: Promise.resolve({ name }) });
}

describe('B5 /workers/[name]/runtime-config（#1231 消费）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceServerSideRbac.mockResolvedValue(null);
  });

  it('GET：非法 Worker 名 → 400，不透传', async () => {
    const res = await callGET('bad/name');
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('GET：透传到 /api/v1/workers/{name}/runtime-config（forwardBody=false）', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ max_iters: 20 }));
    const res = await callGET('worker-1');
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/runtime-config',
      { forwardBody: false, method: 'GET', passthroughHeaders: ['etag'] },
    );
  });

  it('PUT：RBAC 拒绝 → 直接返回，不透传', async () => {
    const denied = NextResponse.json({ error: 'forbidden' }, { status: 403 });
    enforceServerSideRbac.mockResolvedValue(denied);
    const res = await callPUT('worker-1', '{"max_iters":30}');
    expect(res.status).toBe(403);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('PUT：字段级 diff 原样透传（forwardBody=true，method=PUT）', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ ok: true }));
    const res = await callPUT('worker-1', '{"max_iters":30}');
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/runtime-config',
      { forwardBody: true, method: 'PUT', ifMatch: null, passthroughHeaders: ['etag'] },
    );
  });

  it('PUT forwards the version read by the client without changing the body', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ ok: true }));
    const body = '{"max_iters":30}';
    await callPUT('worker-1', body, '"revision-1"');
    const [request, , , options] = proxyToAgentTeams.mock.calls[0];
    expect(await request.text()).toBe(body);
    expect(options).toEqual({
      forwardBody: true, method: 'PUT', ifMatch: '"revision-1"', passthroughHeaders: ['etag'],
    });
  });

  it('409（path lock）原样透传给前端', async () => {
    proxyToAgentTeams.mockResolvedValue(
      NextResponse.json({ error: 'config locked' }, { status: 409 }),
    );
    const res = await callPUT('worker-1', '{"max_iters":30}');
    expect(res.status).toBe(409);
  });

  it('404（#1231 未合并）原样透传 → 前端占位横幅', async () => {
    proxyToAgentTeams.mockResolvedValue(
      NextResponse.json({ error: 'not found' }, { status: 404 }),
    );
    const res = await callGET('worker-1');
    expect(res.status).toBe(404);
  });
});
