import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ proxy: vi.fn(), rbac: vi.fn() }));
vi.mock('../../../proxy-helper', () => ({ getControllerUrl: () => 'http://controller:8090', proxyToAgentTeams: mocks.proxy }));
vi.mock('@/lib/server-auth', () => ({ enforceServerSideRbac: mocks.rbac }));
import { GET, PUT } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rbac.mockResolvedValue(null);
  mocks.proxy.mockResolvedValue(NextResponse.json({ max_iters: 40 }));
});

it('keeps Manager writes on the Manager endpoint with their original version', async () => {
  const request = new NextRequest('http://localhost/api/agentteams/managers/default/runtime-config', {
    method: 'PUT', body: '{"max_iters":45}', headers: { 'If-Match': '"version-1"' },
  });
  await PUT(request, { params: Promise.resolve({ name: 'default', runtimePath: ['runtime-config'] }) });
  expect(mocks.proxy).toHaveBeenCalledWith(request, 'http://controller:8090', '/api/v1/managers/default/runtime-config', {
    method: 'PUT', forwardBody: true, ifMatch: '"version-1"', passthroughHeaders: ['etag'],
  });
});

it('rejects arbitrary proxy paths before contacting the Controller', async () => {
  const result = await GET(new NextRequest('http://localhost/api/agentteams/managers/default/secrets'), {
    params: Promise.resolve({ name: 'default', runtimePath: ['secrets'] }),
  });
  expect(result.status).toBe(400);
  expect(mocks.proxy).not.toHaveBeenCalled();
});

it('enforces configuration permissions on reads as well as writes', async () => {
  mocks.rbac.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
  const result = await GET(new NextRequest('http://localhost/api/agentteams/managers/default/loops'), {
    params: Promise.resolve({ name: 'default', runtimePath: ['loops'] }),
  });
  expect(result.status).toBe(403);
  expect(mocks.proxy).not.toHaveBeenCalled();
});
