import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('@/lib/tracing-access', () => ({ getTraceScope: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn() }));
vi.mock('../proxy-helper', () => ({ getControllerUrl: vi.fn().mockReturnValue('http://controller'), proxyToAgentTeams: vi.fn() }));
import { getTraceScope } from '@/lib/tracing-access';
import { proxyToAgentTeams } from '../proxy-helper';
import { readObservabilityConfig } from '@/lib/observability-config';
import { GET, POST, PUT } from './route';

let directory: string;
const settings = { enabled: true, captureContent: true, mode: 'direct', langfuseUrl: 'http://langfuse.local', publicUrl: '', projectId: 'p', publicKey: 'pk', secretKey: 'super-secret', collectorEndpoint: '', collectorHeaders: '' };
function request(method: string, body?: unknown, level = '3') {
  return new NextRequest('http://localhost/api/agentteams/observability?controllerUrl=http://wrong', { method, headers: {
    'x-agentteams-user': 'alice', 'x-agentteams-user-level': level, 'Content-Type': 'application/json',
  }, body: body ? JSON.stringify(body) : undefined });
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'at-observability-route-'));
  vi.stubEnv('DASHBOARD_CONFIG_FILE', path.join(directory, 'config.json'));
  vi.mocked(getTraceScope).mockResolvedValue({ teams: [], workers: [{ name: 'own', team: '' }] });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('requires admin identity for reading, writing, testing and applying settings', async () => {
  expect((await GET(new NextRequest('http://localhost/api/agentteams/observability'))).status).toBe(401);
  expect((await GET(request('GET', undefined, '2'))).status).toBe(403);
  expect((await PUT(request('PUT', settings, '2'))).status).toBe(403);
  expect((await POST(request('POST', { action: 'test', settings }, '1'))).status).toBe(403);
  expect((await POST(request('POST', { action: 'apply', workers: ['own'] }, '2'))).status).toBe(403);
  expect(proxyToAgentTeams).not.toHaveBeenCalled();
});

it('saves configuration without returning credentials and rejects stale or foreign apply targets', async () => {
  const saved = await (await PUT(request('PUT', settings))).json();
  expect(saved.secretKeyConfigured).toBe(true);
  expect(JSON.stringify(await (await GET(request('GET'))).json())).not.toContain('super-secret');
  expect((await POST(request('POST', { action: 'apply', workers: ['own'], revision: 'old' }))).status).toBe(409);
  expect((await POST(request('POST', { action: 'apply', workers: ['other'], revision: saved.revision }))).status).toBe(404);
  expect(proxyToAgentTeams).not.toHaveBeenCalled();
});

it('merges only telemetry env into managed Workers and never returns injected credentials', async () => {
  const saved = await (await PUT(request('PUT', settings))).json();
  vi.mocked(proxyToAgentTeams).mockImplementation(async (req, _controller, resourcePath, options) => {
    expect(req.nextUrl.searchParams.has('controllerUrl')).toBe(false);
    expect(resourcePath).toBe('/api/v1/workers/own');
    if (options?.method === 'GET') return NextResponse.json({ runtime: 'qwenpaw', containerManaged: true, envEditable: true, env: { KEEP: 'yes' } });
    expect(await req.json()).toEqual({ env: expect.objectContaining({ KEEP: 'yes', AGENTTEAMS_OTEL_ENABLED: 'true', AGENTTEAMS_OTEL_CONFIG_REVISION: saved.revision }) });
    return NextResponse.json({ env: { SHOULD_NOT_RETURN: 'secret' } });
  });
  const response = await POST(request('POST', { action: 'apply', workers: ['own'], revision: saved.revision }));
  expect(await response.json()).toEqual({ results: [{ name: 'own', success: true, revision: saved.revision, message: '配置已下发；托管容器将在重建后生效。' }] });
  expect((await readObservabilityConfig()).secretKey).toBe('super-secret');
});

it('reports unmanaged or unsupported Workers as failures instead of claiming collection is active', async () => {
  const saved = await (await PUT(request('PUT', settings))).json();
  vi.mocked(proxyToAgentTeams).mockResolvedValue(NextResponse.json({ runtime: 'hermes', containerManaged: false, envEditable: true }));
  const data = await (await POST(request('POST', { action: 'apply', workers: ['own'], revision: saved.revision }))).json();
  expect(data.results[0].success).toBe(false);
  expect(proxyToAgentTeams).toHaveBeenCalledTimes(1);
});
