import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/app/api/agentteams/proxy-helper', () => ({ getControllerUrl: vi.fn().mockReturnValue('http://controller'), proxyToAgentTeams: vi.fn() }));
import { proxyToAgentTeams, getControllerUrl } from '@/app/api/agentteams/proxy-helper';
import { observabilityController, controllerObservabilityConfig } from './observability-controller';
afterEach(() => vi.clearAllMocks());
it('uses the caller token and fixed deployment without exposing private configuration', async () => {
  vi.mocked(proxyToAgentTeams).mockImplementation(async (request, target, resource, options) => {
    expect(request.headers.get('authorization')).toBe('Bearer leader-token');
    expect(request.nextUrl.searchParams.has('controllerUrl')).toBe(false);
    expect(target).toBe('http://controller');
    expect(resource).toBe('/api/v1/observability/config');
    expect(options?.timeoutMs).toBe(30000);
    return NextResponse.json({ backend: 'langfuse', secretKeyConfigured: true });
  });
  const request = new NextRequest('http://dashboard/api/agentteams/observability?controllerUrl=http://attacker', { headers: { authorization: 'Bearer leader-token' } });
  const config = await controllerObservabilityConfig(request);
  expect(config.secretKey).toBe('');
  expect(getControllerUrl).toHaveBeenCalled();
});
it('does not replace Controller errors with local configuration', async () => {
  vi.mocked(proxyToAgentTeams).mockResolvedValue(NextResponse.json({ error: 'denied' }, { status: 403 }));
  const request = new NextRequest('http://dashboard/api/agentteams/observability');
  expect((await observabilityController(request, '/api/v1/observability/config')).status).toBe(403);
  await expect(controllerObservabilityConfig(request)).rejects.toMatchObject({ status: 403 });
});
