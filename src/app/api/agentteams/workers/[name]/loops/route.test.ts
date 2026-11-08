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
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/loops`,
    { method: 'GET' },
  );
  return GET(req, { params: Promise.resolve({ name }) });
}

describe('/workers/[name]/loops GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('非法 Worker 名 → 400，不透传', async () => {
    const res = await callGET('bad/name');
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('透传到 /api/v1/workers/{name}/loops（只读）', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json([]));
    const res = await callGET('worker-1');
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/worker-1/loops',
      { forwardBody: false, method: 'GET' },
    );
  });
});
