import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const proxy = vi.fn();
vi.mock('./proxy-helper', () => ({ getControllerUrl: () => 'http://controller:8080', proxyToAgentTeams: (...args: unknown[]) => proxy(...args) }));
import { GET as workerHealth } from './workers/[name]/health/route';
import { GET as managerHealth } from './managers/[name]/health/route';
beforeEach(() => { proxy.mockReset(); });
for (const [kind, handler] of [['workers', workerHealth], ['managers', managerHealth]] as const) {
  it(`forwards ${kind} health reads without body or caching`, async () => {
    proxy.mockResolvedValue(Response.json({ version: 1, status: 'unknown' }));
    const request = new NextRequest('http://localhost/api/agentteams/health', { headers: { Authorization: 'Bearer fixture' } });
    const response = await handler(request, { params: Promise.resolve({ name: 'a/b' }) });
    expect(proxy).toHaveBeenCalledWith(request, 'http://controller:8080', `/api/v1/${kind}/a%2Fb/health`, { forwardBody: false, method: 'GET' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).status).toBe('unknown');
  });
  it(`preserves ${kind} upstream authorization failures`, async () => {
    proxy.mockResolvedValue(Response.json({ error: 'forbidden' }, { status: 403 }));
    const response = await handler(new NextRequest('http://localhost/health'), { params: Promise.resolve({ name: 'alice' }) });
    expect(response.status).toBe(403);
  });
}
