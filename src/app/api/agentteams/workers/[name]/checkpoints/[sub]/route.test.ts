import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxyToAgentTeams = vi.fn();
const getControllerUrl = vi.fn((..._args: unknown[]) => 'http://agentteams-controller:8090');

vi.mock('../../../../proxy-helper', () => ({
  proxyToAgentTeams: (...args: unknown[]) => proxyToAgentTeams(...args),
  getControllerUrl: (...args: unknown[]) => getControllerUrl(...args),
}));

import { GET } from './route';

function call(name: string, sub: string, search = '') {
  const url = `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/checkpoints/${sub}${search}`;
  return GET(new NextRequest(url, { method: 'GET' }), { params: Promise.resolve({ name, sub }) });
}

describe('/workers/[name]/checkpoints/[sub] GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid worker names', async () => {
    expect((await call('bad/name', 'graph')).status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('rejects unknown subpaths', async () => {
    expect((await call('w1', 'nodes')).status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('forwards graph with the limit query', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ nodes: [] }));
    const res = await call('w1', 'graph', '?limit=20');
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/w1/checkpoints/graph?limit=20',
      { forwardBody: false, method: 'GET' },
    );
  });

  it('forwards status without query', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ auto_enabled: true }));
    await call('w1', 'status', '?bogus=1');
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      '/api/v1/workers/w1/checkpoints/status',
      { forwardBody: false, method: 'GET' },
    );
  });

  it('passes 404 / 403 / 502 / 503 through', async () => {
    for (const status of [404, 403, 502, 503]) {
      proxyToAgentTeams.mockResolvedValue(NextResponse.json({ error: 'x' }, { status }));
      expect((await call('w1', 'status')).status).toBe(status);
    }
  });
});
