import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/lib/observability-controller', () => ({ controllerObservabilityConfig: vi.fn(), observabilityController: vi.fn() }));
vi.mock('@/lib/tracing-access', () => ({ getTraceScope: vi.fn() }));
import { controllerObservabilityConfig, observabilityController } from '@/lib/observability-controller';
import { getTraceScope } from '@/lib/tracing-access';
import { GET } from './route';
afterEach(() => vi.clearAllMocks());
it('forwards direct trace lookups to the Controller with its native authorization', async () => {
  const id = 'a'.repeat(32);
  vi.mocked(getTraceScope).mockResolvedValue({ teams: [], workers: [{ name: 'own', team: '' }] });
  vi.mocked(controllerObservabilityConfig).mockResolvedValue({ backend: 'langfuse' } as Awaited<ReturnType<typeof controllerObservabilityConfig>>);
  vi.mocked(observabilityController).mockImplementation(async () => NextResponse.json({ error: 'trace not found or not authorized' }, { status: 404 }));
  const request = new NextRequest('http://localhost/api/agentteams/traces/' + id, { headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '1' } });
  expect((await GET(request, { params: Promise.resolve({ traceId: id }) })).status).toBe(404);
  expect(observabilityController).toHaveBeenCalledWith(request, '/api/v1/traces/' + id);
});
