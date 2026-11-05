import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/langfuse-server', () => ({ listTraces: vi.fn(), TracingError: class extends Error {} }));
import { listTraces } from '@/lib/langfuse-server';
import { GET } from './route';

afterEach(() => vi.clearAllMocks());
describe('tracing admin boundary', () => {
  it('requires a session identity', async () => {
    expect((await GET(new NextRequest('http://localhost/api/agentteams/traces'))).status).toBe(401);
    expect(listTraces).not.toHaveBeenCalled();
  });
  it('denies team-scoped users before querying the project', async () => {
    const request = new NextRequest('http://localhost/api/agentteams/traces', {
      headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': '2' },
    });
    expect((await GET(request)).status).toBe(403);
    expect(listTraces).not.toHaveBeenCalled();
  });
});
