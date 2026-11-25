import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/lib/observability-controller', () => ({ controllerObservabilityConfig: vi.fn(), observabilityController: vi.fn() }));
vi.mock('@/lib/tracing-access', () => ({ getTraceScope: vi.fn() }));
import { controllerObservabilityConfig, observabilityController } from '@/lib/observability-controller';
import { getTraceScope } from '@/lib/tracing-access';
import { TracingError } from '@/lib/tracing-error';
import { GET } from './route';

afterEach(() => vi.clearAllMocks());
it('requires an authenticated and verified resource scope', async () => {
  expect((await GET(new NextRequest('http://localhost/api/agentteams/traces'))).status).toBe(401);
  const request = new NextRequest('http://localhost/api/agentteams/traces', { headers: { 'x-agentteams-user': 'alice' } });
  vi.mocked(getTraceScope).mockRejectedValue(new TracingError(403, 'scope denied'));
  expect((await GET(request)).status).toBe(403);
  expect(observabilityController).not.toHaveBeenCalled();
});
it('reads Langfuse traces through the Controller and removes caller-selected Controller addresses', async () => {
  vi.mocked(getTraceScope).mockResolvedValue({ teams: [], workers: [] });
  vi.mocked(controllerObservabilityConfig).mockResolvedValue({ backend: 'langfuse' } as Awaited<ReturnType<typeof controllerObservabilityConfig>>);
  vi.mocked(observabilityController).mockResolvedValue(NextResponse.json({ data: [], meta: { totalItems: 0 } }));
  const request = new NextRequest('http://localhost/api/agentteams/traces?task=t&controllerUrl=http://wrong', { headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '2' } });
  expect((await GET(request)).status).toBe(200);
  expect(observabilityController).toHaveBeenCalledWith(request, '/api/v1/traces?task=t');
});
it('returns only the current account resource choices', async () => {
  vi.mocked(getTraceScope).mockResolvedValue({ teams: [], workers: [{ name: 'own', team: '' }] });
  vi.mocked(controllerObservabilityConfig).mockResolvedValue({ backend: 'langfuse', enabled: true, collectorEndpoint: 'http://collector:4318', langfuseUrl: 'http://langfuse:3000', secretKey: 'must-not-leak' } as Awaited<ReturnType<typeof controllerObservabilityConfig>>);
  const request = new NextRequest('http://localhost/api/agentteams/traces?options=resources', { headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '1' } });
  expect(await (await GET(request)).json()).toEqual({ teams: [], workers: [{ name: 'own', team: '' }], canConfigure: false, tracingConfigured: true, tracingEnabled: true });
  expect(observabilityController).not.toHaveBeenCalled();
});

it('reports missing collection configuration without querying the trace backend', async () => {
  vi.mocked(getTraceScope).mockResolvedValue({ teams: [], workers: [] });
  vi.mocked(controllerObservabilityConfig).mockResolvedValue({ backend: 'langfuse', enabled: false, collectorEndpoint: '', langfuseUrl: '' } as Awaited<ReturnType<typeof controllerObservabilityConfig>>);
  const request = new NextRequest('http://localhost/api/agentteams/traces?options=resources', { headers: { 'x-agentteams-user': 'admin', 'x-agentteams-user-level': '3' } });
  expect(await (await GET(request)).json()).toMatchObject({ canConfigure: true, tracingConfigured: false, tracingEnabled: false });
  expect(observabilityController).not.toHaveBeenCalled();
});
