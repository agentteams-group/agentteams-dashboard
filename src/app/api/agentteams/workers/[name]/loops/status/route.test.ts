import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxyToAgentTeams = vi.fn();
const getControllerUrl = vi.fn((..._args: unknown[]) => 'http://agentteams-controller:8090');

vi.mock('../../../../proxy-helper', () => ({
  proxyToAgentTeams: (...args: unknown[]) => proxyToAgentTeams(...args),
  getControllerUrl: (...args: unknown[]) => getControllerUrl(...args),
}));

import { GET } from './route';

function call(name: string, search = '') {
  const url = `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/loops/status${search}`;
  return GET(new NextRequest(url, { method: 'GET' }), { params: Promise.resolve({ name }) });
}

describe('/workers/[name]/loops/status GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid worker names', async () => {
    expect((await call('bad/name', '?session_id=x')).status).toBe(400);
  });

  it('requires session_id', async () => {
    expect((await call('w1')).status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('forwards the session_id to the controller', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ state: 'idle' }));
    const res = await call('w1', `?session_id=${encodeURIComponent('matrix:!room:server')}`);
    expect(res.status).toBe(200);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'http://agentteams-controller:8090',
      `/api/v1/workers/w1/loops/status?session_id=${encodeURIComponent('matrix:!room:server')}`,
      { forwardBody: false, method: 'GET' },
    );
  });

  it('passes 404 through so the loop row can hide', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ error: 'not found' }, { status: 404 }));
    expect((await call('w1', '?session_id=x')).status).toBe(404);
  });
});
