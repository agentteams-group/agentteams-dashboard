import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET, PUT } from './route';
import { requireHigressConsoleAccess } from '../../../higress/access';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';
vi.mock('../../../higress/access', () => ({ requireHigressConsoleAccess: vi.fn() }));
vi.mock('../../proxy-helper', () => ({ getControllerUrl: vi.fn(() => 'http://controller.test'), proxyToAgentTeams: vi.fn() }));
const request = (method: string) => new NextRequest('http://dashboard/api/agentteams/models/probe-policy', { method, ...(method === 'PUT' ? { body: JSON.stringify({ allowedHosts: ['172.16.50.89'], allowPrivateNetwork: false, revision: '1' }) } : {}) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getControllerUrl).mockReturnValue('http://controller.test'); vi.mocked(requireHigressConsoleAccess).mockResolvedValue(null); vi.mocked(proxyToAgentTeams).mockResolvedValue(NextResponse.json({ allowedHosts: [], allowPrivateNetwork: false, revision: '' })); });
describe('model probe policy proxy', () => {
 it.each([GET, PUT])('requires administrator access before forwarding', async handler => {
  vi.mocked(requireHigressConsoleAccess).mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
  expect((await handler(request(handler === GET ? 'GET' : 'PUT'))).status).toBe(403);
  expect(proxyToAgentTeams).not.toHaveBeenCalled();
 });
 it.each(['GET', 'PUT'])('forwards %s only to the Controller policy resource without caching', async method => {
  const req = request(method); const response = await (method === 'GET' ? GET(req) : PUT(req));
  expect(proxyToAgentTeams).toHaveBeenCalledWith(req, 'http://controller.test', '/api/v1/gateway/model-probe-policy', { method, forwardBody: method === 'PUT' });
  expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it.each([401,403,404,409,503])('preserves Controller failure %s', async status => {
  vi.mocked(proxyToAgentTeams).mockResolvedValue(NextResponse.json({ error: 'failed' }, { status }));
  expect((await PUT(request('PUT'))).status).toBe(status);
  expect(proxyToAgentTeams).toHaveBeenCalledTimes(1);
 });
});
