// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { callControllerAsset } from '@/app/api/higress/controller-helper';
import { saveManagedMcp } from '@/lib/server/mcp-management';

vi.mock('@/app/api/higress/access', () => ({ requireHigressConsoleAccess: vi.fn(async () => null) }));
vi.mock('@/app/api/higress/controller-helper', () => ({ callControllerAsset: vi.fn() }));
vi.mock('@/lib/server/mcp-management', () => ({ saveManagedMcp: vi.fn(async () => ({ legacy: true })), McpManagementError: class extends Error {}, mcpCapabilities: vi.fn(async () => ({ legacy: true })) }));
beforeEach(() => vi.clearAllMocks());
const request = () => new NextRequest('http://dashboard/api/agentteams/mcps/manage', { method: 'POST', body: JSON.stringify({ action: 'save', input: { name: 'docs' } }) });

it('uses Controller for MCP management', async () => {
  vi.mocked(callControllerAsset).mockResolvedValue({ response: Response.json({}), body: { name: 'docs', managed: true } });
  expect(await (await POST(request())).json()).toEqual({ name: 'docs', managed: true });
  expect(saveManagedMcp).not.toHaveBeenCalled();
});
it('preserves Controller permission and upstream failures', async () => {
  vi.mocked(callControllerAsset).mockResolvedValue({ response: Response.json({}, { status: 403 }), body: { error: 'denied' } });
  expect((await POST(request())).status).toBe(403);
  expect(saveManagedMcp).not.toHaveBeenCalled();
});
it('keeps legacy management for deployments without the capability', async () => {
  vi.mocked(callControllerAsset).mockResolvedValue(null);
  expect(await (await POST(request())).json()).toEqual({ legacy: true });
  expect(saveManagedMcp).toHaveBeenCalled();
});
it('reads capabilities from Controller', async () => {
  vi.mocked(callControllerAsset).mockResolvedValue({ response: Response.json({}), body: { available: true } });
  expect(await (await GET(request())).json()).toEqual({ available: true });
});
