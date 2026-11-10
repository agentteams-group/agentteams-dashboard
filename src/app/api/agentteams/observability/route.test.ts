import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/lib/observability-controller', () => ({ observabilityController: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn() }));
import { observabilityController } from '@/lib/observability-controller';
import { GET, POST, PUT } from './route';

function request(method: string, body?: unknown, level = '3') {
  return new NextRequest('http://localhost/api/agentteams/observability?controllerUrl=http://wrong', {
    method, headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': level, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
afterEach(() => vi.clearAllMocks());

it('requires administrator identity before any configuration operation', async () => {
  expect((await GET(new NextRequest('http://localhost/api/agentteams/observability'))).status).toBe(401);
  expect((await GET(request('GET', undefined, '2'))).status).toBe(403);
  expect((await PUT(request('PUT', {}, '2'))).status).toBe(403);
  expect((await POST(request('POST', { action: 'apply' }, '1'))).status).toBe(403);
  expect(observabilityController).not.toHaveBeenCalled();
});

it('reads and saves the Controller configuration, preserving its revision and blank write-only fields', async () => {
  vi.mocked(observabilityController).mockImplementation(async () => NextResponse.json({ revision: 'controller-revision', secretKeyConfigured: true }));
  const settings = { revision: 'previous', secretKey: '', collectorHeaders: '', enabled: true };
  const read = request('GET');
  expect(await (await GET(read)).json()).toMatchObject({ revision: 'controller-revision' });
  expect(observabilityController).toHaveBeenCalledWith(read, '/api/v1/observability/config', 'GET', undefined);
  const update = request('PUT', settings);
  expect(await (await PUT(update)).json()).toMatchObject({ secretKeyConfigured: true });
  expect(observabilityController).toHaveBeenLastCalledWith(update, '/api/v1/observability/config', 'PUT', settings);
});

it('uses Controller test/apply APIs and preserves upstream failure status', async () => {
  vi.mocked(observabilityController).mockImplementation(async () => NextResponse.json({ error: 'configuration changed' }, { status: 409 }));
  for (const action of ['test', 'apply']) {
    const body = { action, workers: ['own'], revision: 'stale' };
    const req = request('POST', body);
    expect((await POST(req)).status).toBe(409);
    expect(observabilityController).toHaveBeenLastCalledWith(req, '/api/v1/observability/' + action, 'POST', body);
  }
  expect((await POST(request('POST', { action: 'unknown' }))).status).toBe(400);
});
