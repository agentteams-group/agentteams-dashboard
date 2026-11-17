import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { rbac, upstream } = vi.hoisted(() => ({ rbac: vi.fn(), upstream: vi.fn() }));
vi.mock('@/lib/server-auth', () => ({ enforceServerSideRbac: rbac }));
vi.mock('../../../proxy-helper', () => ({
  getControllerUrl: () => 'http://controller',
  proxyToAgentTeams: upstream,
}));

const url = 'http://local/api/agentteams/workers/a/runtime-handoff';
const ctx = { params: Promise.resolve({ name: 'a' }) };

describe('operator Worker handoff proxy', () => {
  beforeEach(() => { vi.resetAllMocks(); rbac.mockResolvedValue(null); });
  it('reads authoritative status and ETag from the CLI endpoint', async () => {
    upstream.mockResolvedValue(NextResponse.json({}, { headers: { ETag: '"revision"' } }));
    const request = new NextRequest(url);
    const res = await GET(request, ctx);
    expect(res.headers.get('ETag')).toBe('"revision"');
    expect(rbac).toHaveBeenCalledWith(request, 'view', 'worker', 'a');
    expect(upstream).toHaveBeenCalledWith(request, 'http://controller', '/api/v1/workers/a/runtime-handoff',
      { method: 'GET', forwardBody: false, forwardRequestHeaders: [], passthroughHeaders: ['etag'] });
  });
  it.each([['If-Match', '"revision"'], ['If-None-Match', '*']])('preserves %s and the same request body', async (header, value) => {
    const body = JSON.stringify({ request_id: 'same-request', target_runtime: 'qwenpaw' });
    const request = new NextRequest(url, { method: 'POST', body, headers: { [header]: value } });
    upstream.mockResolvedValue(NextResponse.json({ error: 'competing operation' }, { status: 409 }));
    const res = await POST(request, ctx);
    expect(res.status).toBe(409);
    expect(rbac).toHaveBeenCalledWith(request, 'update', 'worker', 'a');
    const [forwarded, , path, options] = upstream.mock.calls[0];
    expect(path).toBe('/api/v1/workers/a/runtime-handoff');
    expect(options.forwardRequestHeaders).toContain(header);
    expect(forwarded.headers.get(header)).toBe(value);
    expect(await forwarded.text()).toBe(body);
  });
  it('denies an unauthorized write before forwarding', async () => {
    rbac.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await POST(new NextRequest(url, { method: 'POST' }), ctx)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
