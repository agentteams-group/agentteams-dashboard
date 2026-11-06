import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/langfuse-server', async (original) => ({ ...await original<typeof import('@/lib/langfuse-server')>(), getTrace: vi.fn() }));
vi.mock('@/lib/tracing-access', () => ({ getTraceScope: vi.fn() }));
import { getTrace, TracingError } from '@/lib/langfuse-server';
import { getTraceScope } from '@/lib/tracing-access';
import type { TraceDetail } from '@/lib/tracing-types';
import { GET } from './route';

afterEach(() => vi.clearAllMocks());
it('checks direct trace links against the current account scope and hides project links from scoped users', async () => {
  const id = 'a'.repeat(32);
  const scope = { teams: [], workers: [{ name: 'own', team: '' }] };
  vi.mocked(getTraceScope).mockResolvedValue(scope);
  vi.mocked(getTrace).mockResolvedValue({ id, backendUrl: 'https://agentloop.console.aliyun.com/', langfuseUrl: 'http://langfuse/project' } as TraceDetail);
  const request = new NextRequest('http://localhost/api/agentteams/traces/' + id, { headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '1' } });
  const context = { params: Promise.resolve({ traceId: id }) };
  expect(await (await GET(request, context)).json()).toEqual({ id, backendUrl: null, langfuseUrl: null });
  expect(getTrace).toHaveBeenCalledWith(id, scope);
  vi.mocked(getTrace).mockRejectedValue(new TracingError(404, 'internal detail'));
  const denied = await GET(request, context);
  expect(denied.status).toBe(404);
  expect(await denied.json()).toEqual({ error: 'Trace 不存在或无权访问' });
});
