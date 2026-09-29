import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const proxyMock = vi.fn();
const controllerUrlMock = vi.fn();
const rbacMock = vi.fn();

vi.mock('../../../proxy-helper', () => ({
  getControllerUrl: (...args: unknown[]) => controllerUrlMock(...args),
  proxyToAgentTeams: (...args: unknown[]) => proxyMock(...args),
}));
vi.mock('@/lib/server-auth', () => ({
  enforceLevelOnlyRbac: (...args: unknown[]) => rbacMock(...args),
}));

import { POST } from './route';

function callPOST(name: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/gateway-probe`,
    { method: 'POST' },
  );
  return POST(req, { params: Promise.resolve({ name }) });
}

describe('POST /workers/[name]/gateway-probe (B1: saved gateway access verification)', () => {
  beforeEach(() => {
    proxyMock.mockReset();
    controllerUrlMock.mockReset();
    rbacMock.mockReset();
    controllerUrlMock.mockReturnValue('http://controller:8080');
  });

  it('returns the RBAC denial as-is when the level check rejects', async () => {
    rbacMock.mockResolvedValue(new Response('{"error":"forbidden"}', { status: 403 }));
    const res = await callPOST('worker-1');
    expect(res.status).toBe(403);
    // Proxy must never be reached on a denial.
    expect(proxyMock).not.toHaveBeenCalled();
  });

  it('proxies to the controller gateway-probe endpoint with the level check arguments', async () => {
    proxyMock.mockResolvedValue(new Response('{"ok":true,"status":"reachable"}', { status: 200 }));
    rbacMock.mockResolvedValue(null);

    const res = await callPOST('worker-1');

    expect(rbacMock).toHaveBeenCalledWith(expect.anything(), 'update', 'gateway.consumer', 'worker-1');
    expect(controllerUrlMock).toHaveBeenCalledWith(expect.anything());
    expect(proxyMock).toHaveBeenCalledTimes(1);
    const [req, url, path] = proxyMock.mock.calls[0];
    expect(url).toBe('http://controller:8080');
    expect(path).toBe('/api/v1/workers/worker-1/gateway-probe');
    expect(req.method).toBe('POST');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('reachable');
  });

  it('URL-encodes worker names with reserved characters', async () => {
    proxyMock.mockResolvedValue(new Response('{}', { status: 200 }));
    rbacMock.mockResolvedValue(null);

    await callPOST('team a/worker#1');

    const path = proxyMock.mock.calls[0][2] as string;
    expect(path).toBe('/api/v1/workers/team%20a%2Fworker%231/gateway-probe');
  });

  it('passes proxy failures through unchanged (error semantics stay upstream)', async () => {
    proxyMock.mockResolvedValue(new Response('{"error":"probe failed: 409 consumer missing"}', { status: 502 }));
    rbacMock.mockResolvedValue(null);

    const res = await callPOST('worker-1');
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain('probe failed');
  });
});
