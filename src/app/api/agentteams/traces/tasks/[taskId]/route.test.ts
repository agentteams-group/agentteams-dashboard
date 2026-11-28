import { expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/lib/observability-controller', () => ({ observabilityController: vi.fn() }));
import { observabilityController } from '@/lib/observability-controller';
import { GET } from './route';

it('requires login and forwards only Task identity and Team to the fixed Controller', async () => {
  const context = { params: Promise.resolve({ taskId: 'main' }) };
  expect((await GET(new NextRequest('http://localhost/api/agentteams/traces/tasks/main'), context)).status).toBe(401);
  vi.mocked(observabilityController).mockResolvedValue(NextResponse.json({ task_id: 'main' }));
  const request = new NextRequest('http://localhost/api/agentteams/traces/tasks/main?team=own&controllerUrl=http://untrusted&worker=foreign', { headers: { 'x-agentteams-user': 'alice' } });
  expect((await GET(request, context)).status).toBe(200);
  expect(observabilityController).toHaveBeenCalledWith(request, '/api/v1/tasks/main/traces?team=own', 'GET', undefined, 90000);
});
