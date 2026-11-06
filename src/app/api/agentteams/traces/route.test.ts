import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/langfuse-server', async (original) => ({ ...await original<typeof import('@/lib/langfuse-server')>(), listTraces: vi.fn() }));
vi.mock('@/lib/tracing-access', () => ({ getTraceScope: vi.fn() }));
import { listTraces, TracingError } from '@/lib/langfuse-server';
import { getTraceScope } from '@/lib/tracing-access';
import { GET } from './route';

afterEach(() => vi.clearAllMocks());
describe('tracing resource boundary', () => {
  it('requires a session identity', async () => {
    expect((await GET(new NextRequest('http://localhost/api/agentteams/traces'))).status).toBe(401);
    expect(listTraces).not.toHaveBeenCalled();
  });
  it('allows scoped users using their server-resolved resource scope', async () => {
    const scope = { teams: [{ name: 't', label: 'T' }], workers: [{ name: 'w', team: 't' }] };
    vi.mocked(getTraceScope).mockResolvedValue(scope);
    vi.mocked(listTraces).mockResolvedValue({ data: [], meta: { page: 1, totalItems: 0, totalPages: 0 } });
    const request = new NextRequest('http://localhost/api/agentteams/traces', {
      headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '2' },
    });
    expect((await GET(request)).status).toBe(200);
    expect(listTraces).toHaveBeenCalledWith(request.nextUrl.searchParams, scope);
  });
  it('returns only scoped resource options and fails closed on permission errors', async () => {
    const request = new NextRequest('http://localhost/api/agentteams/traces?options=resources', {
      headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '1' },
    });
    vi.mocked(getTraceScope).mockResolvedValue({ teams: [], workers: [{ name: 'own', team: '' }] });
    expect(await (await GET(request)).json()).toEqual({ teams: [], workers: [{ name: 'own', team: '' }] });
    vi.mocked(getTraceScope).mockRejectedValue(new TracingError(403, 'scope denied'));
    expect((await GET(request)).status).toBe(403);
    expect(listTraces).not.toHaveBeenCalled();
  });
});
