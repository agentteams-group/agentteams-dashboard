// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxy = vi.hoisted(() => ({ getControllerUrl: vi.fn(() => 'http://controller'), proxyToAgentTeams: vi.fn() }));
vi.mock('../proxy-helper', () => proxy);
vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn().mockResolvedValue(undefined) }));
import { GET } from './route';
import { GET as logsGET } from './[kind]/[name]/logs/route';

function request(path: string, level: number) {
  return new NextRequest(`http://x/api/agentteams/monitoring${path}`, { headers: { 'x-agentteams-user': 'tester', 'x-agentteams-user-level': String(level) } });
}

beforeEach(() => { vi.clearAllMocks(); proxy.proxyToAgentTeams.mockResolvedValue(NextResponse.json({ items: [] })); });

describe('monitoring Controller proxy', () => {
  it('forwards only supported query parameters and disables caching', async () => {
    const res = await GET(request('?page=2&limit=12&search=dev&container=unrelated', 3));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(proxy.proxyToAgentTeams).toHaveBeenCalledWith(expect.anything(), 'http://controller', '/api/v1/monitoring?page=2&limit=12&search=dev', { forwardBody: false });
  });
  it('denies scoped sessions before contacting the Controller', async () => {
    expect((await GET(request('', 2))).status).toBe(403);
    expect(proxy.proxyToAgentTeams).not.toHaveBeenCalled();
  });
  it('validates log resource paths and preserves the time filter', async () => {
    const res = await logsGET(request('/worker/dev/logs?tail=300&since=2026-11-14T00%3A00%3A00Z', 3), { params: Promise.resolve({ kind: 'worker', name: 'dev' }) });
    expect(res.status).toBe(200);
    expect(proxy.proxyToAgentTeams).toHaveBeenCalledWith(expect.anything(), 'http://controller', '/api/v1/monitoring/worker/dev/logs?tail=300&since=2026-11-14T00%3A00%3A00Z', { forwardBody: false });
    proxy.proxyToAgentTeams.mockClear();
    expect((await logsGET(request('', 3), { params: Promise.resolve({ kind: 'container', name: '..' }) })).status).toBe(400);
    expect(proxy.proxyToAgentTeams).not.toHaveBeenCalled();
  });
});
