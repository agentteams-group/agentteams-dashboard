import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxyToAgentTeams = vi.fn();
const getControllerUrl = vi.fn((..._a: unknown[]) => 'http://agentteams-controller:8090');

vi.mock('../../../proxy-helper', () => ({
  proxyToAgentTeams: (...a: unknown[]) => proxyToAgentTeams(...a),
  getControllerUrl: (...a: unknown[]) => getControllerUrl(...a),
}));

import { GET } from './route';

function callGET(name: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/coding-cli`,
    { method: 'GET' },
  );
  return GET(req, { params: Promise.resolve({ name }) });
}

describe('B7 /workers/[name]/coding-cli 探测（#1360 消费）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET：非法 Worker 名 → 400，不透传', async () => {
    const res = await callGET('bad/name');
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('GET：透传到 /api/v1/workers/{name}/coding-cli（forwardBody=false）', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ clis: [] }));
    const res = await callGET('worker-1');
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/coding-cli',
      { forwardBody: false, method: 'GET' },
    );
  });

  it('上游 404 原样透传 → 前端占位横幅', async () => {
    proxyToAgentTeams.mockResolvedValue(
      NextResponse.json({ detail: 'not found' }, { status: 404 }),
    );
    const res = await callGET('w1');
    expect(res.status).toBe(404);
  });
});
