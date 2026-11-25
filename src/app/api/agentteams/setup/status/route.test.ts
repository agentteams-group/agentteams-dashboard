// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { proxyToAgentTeams } = vi.hoisted(() => ({ proxyToAgentTeams: vi.fn() }));

vi.mock('../../proxy-helper', () => ({
  getControllerUrl: () => 'http://controller.test:8090',
  proxyToAgentTeams,
}));

import { GET } from './route';

function call() {
  return GET(new NextRequest('http://localhost/api/agentteams/setup/status/'));
}

describe('/api/agentteams/setup/status proxy shape', () => {
  beforeEach(() => {
    proxyToAgentTeams.mockReset();
  });

  it.each([404, 405, 501])(
    'maps an upstream %i (controller has no setup/status) to 200 degraded',
    async (status) => {
      proxyToAgentTeams.mockResolvedValue(
        NextResponse.json({ error: '404 page not found' }, { status }),
      );

      const res = await call();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ setupRequired: false, degraded: true });
    },
  );

  it('passes a healthy controller payload through unchanged', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ setupRequired: true }));

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setupRequired: true });
  });

  it('keeps other upstream errors (e.g. 500) as errors', async () => {
    proxyToAgentTeams.mockResolvedValue(
      NextResponse.json({ message: 'controller exploded' }, { status: 500 }),
    );

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '{"message":"controller exploded"}' });
  });
});
