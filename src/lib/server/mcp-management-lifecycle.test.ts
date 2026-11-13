// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { callHigressConsole, getHigressConsoleURL } from '@/app/api/higress/proxy-helper';
import { proxyToAgentTeams } from '@/app/api/agentteams/proxy-helper';
import { withMcpClient } from './mcp-client';
import { authorizeManagedMcp, deleteManagedMcp, mcpCapabilities, publicMcpRecord, saveManagedMcp, verifyManagedMcp, type ManagedMcpRecord } from './mcp-management';
import { emptyMcpConnection } from '@/lib/mcp-management';

vi.mock('@/lib/minio-client', () => ({ createMinioClient: vi.fn(), getMinioBucket: vi.fn() }));
vi.mock('@/lib/backend-config', () => ({ pickBackendUrl: () => 'http://gateway.test' }));
vi.mock('@/app/api/higress/proxy-helper', async (original) => ({ ...await original<typeof import('@/app/api/higress/proxy-helper')>(), callHigressConsole: vi.fn(), getHigressConsoleURL: vi.fn() }));
vi.mock('@/app/api/higress/helpers', async (original) => ({ ...await original<typeof import('@/app/api/higress/helpers')>(), getSessionCookie: () => null }));
vi.mock('@/app/api/agentteams/proxy-helper', () => ({ getControllerUrl: () => 'http://controller.test', proxyToAgentTeams: vi.fn() }));
vi.mock('./mcp-client', () => ({ withMcpClient: vi.fn(), listMcpTools: vi.fn() }));

const request = () => new NextRequest('http://dashboard.test/api/agentteams/mcps/manage');
const store = new Map<string, ManagedMcpRecord>();
const key = 'mcp-servers/docs.json';
const originalServers = [{ name: 'docs', url: 'http://gateway.test/mcp-servers/docs', transport: 'http' }, { name: 'other', url: 'http://gateway.test/mcp-servers/other', transport: 'http' }];
const getObject = vi.fn();
const putObject = vi.fn();
const removeObject = vi.fn();
function record(): ManagedMcpRecord {
  return { name: 'docs', managed: true, connection: { ...emptyMcpConnection(), backendUrl: 'http://backend.test/mcp', auth: { type: 'bearer', secret: 'backend-secret' } },
    url: 'http://gateway.test/mcp-servers/docs', transport: 'streaminghttp', createdAt: '2026-11-14T01:00:00Z', updatedAt: '2026-11-14T01:00:00Z', gatewayState: 'ready',
    authorizedWorkers: ['agent-a'], workerConsumers: { 'agent-a': 'worker-deployed-a' }, probe: { name: 'probe-docs', key: 'probe-secret' } };
}
function consoleResult(data: unknown = null) { return { response: new Response(null, { status: 200 }), body: { success: true, data } }; }

beforeEach(() => {
  vi.clearAllMocks(); store.clear();
  vi.mocked(getMinioBucket).mockReturnValue('test-bucket');
  vi.mocked(createMinioClient).mockReturnValue({ getObject, putObject, removeObject } as never);
  getObject.mockImplementation(async (_bucket: string, path: string) => {
    const saved = store.get(path);
    if (!saved) throw Object.assign(new Error('Not found'), { code: 'NoSuchKey' });
    const bytes = Buffer.from(JSON.stringify(saved));
    return (async function* () { yield bytes; })();
  });
  putObject.mockImplementation(async (_bucket: string, path: string, data: Buffer) => { store.set(path, JSON.parse(data.toString())); });
  removeObject.mockImplementation(async (_bucket: string, path: string) => { store.delete(path); });
  vi.mocked(getHigressConsoleURL).mockReturnValue('http://console.test');
  vi.mocked(callHigressConsole).mockImplementation(async (path) => consoleResult(path === '/v1/wasm-plugins/transformer' ? { imageRepository: 'oci://plugins/transformer', imageVersion: '1.0.0' } : null));
  vi.mocked(proxyToAgentTeams).mockImplementation(async (_request, _base, path) => NextResponse.json(path === '/api/v1/workers' ? { workers: [] } : path === '/api/v1/managers' ? { managers: [] } : { name: 'deployed-a', mcpServers: originalServers }));
});
afterEach(() => vi.unstubAllEnvs());

describe('managed MCP lifecycle', () => {
  it.each(['gateway', 'source'])('rejects a pre-existing %s resource before writing anything', async (collision) => {
    vi.mocked(callHigressConsole).mockImplementation(async (path) => consoleResult(path === (collision === 'gateway' ? '/v1/mcpServer/docs' : '/v1/service-sources/at-mcp-docs') ? { name: 'existing' } : null));
    await expect(saveManagedMcp(request(), { name: 'docs', connection: record().connection })).rejects.toMatchObject({ status: 409 });
    expect(putObject).not.toHaveBeenCalled();
    expect(vi.mocked(callHigressConsole).mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  });

  it('discards an old verification after credentials have been edited', async () => {
    store.set(key, record());
    vi.mocked(withMcpClient).mockImplementation(async () => {
      const newer = record(); newer.updatedAt = '2026-11-14T01:01:00Z'; newer.connection.auth.secret = 'rotated-secret';
      store.set(key, newer);
      return { tools: [] };
    });
    const result = await verifyManagedMcp('docs');
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('配置已更新') });
    expect(store.get(key)?.connection.auth.secret).toBe('rotated-secret');
    expect(putObject).not.toHaveBeenCalled();
  });

  it('preserves a concurrent authorization change when persisting verification', async () => {
    store.set(key, record());
    vi.mocked(withMcpClient).mockImplementation(async () => { store.set(key, { ...record(), authorizedWorkers: ['agent-b'] }); return { tools: [] }; });
    expect((await verifyManagedMcp('docs')).success).toBe(true);
    expect(store.get(key)?.authorizedWorkers).toEqual(['agent-b']);
  });

  it('keeps failed revocation cleanup retryable and never re-grants it on a connection edit', async () => {
    store.set(key, record());
    let failUpdate = true;
    vi.mocked(proxyToAgentTeams).mockImplementation(async (_request, _base, _path, options) => options?.method === 'PUT' && failUpdate ? NextResponse.json({ error: 'offline' }, { status: 503 }) : NextResponse.json({ name: 'deployed-a', mcpServers: originalServers }));
    const result = await authorizeManagedMcp(request(), 'docs', []);
    expect(result).toMatchObject({ success: false, authorizedWorkers: [], pendingRemovalWorkers: ['agent-a'] });
    expect(result.results[0].message).toContain('权限已撤销');
    await saveManagedMcp(request(), { name: 'docs', connection: record().connection });
    const savedGateway = vi.mocked(callHigressConsole).mock.calls.find(([path, options]) => path === '/v1/mcpServer' && options?.method === 'PUT');
    expect(savedGateway?.[1]?.body).toMatchObject({ consumerAuthInfo: { allowedConsumers: ['probe-docs'] } });
    failUpdate = false;
    const retried = await authorizeManagedMcp(request(), 'docs', []);
    expect(retried).toMatchObject({ success: true, authorizedWorkers: [], pendingRemovalWorkers: [] });
    const updates = vi.mocked(proxyToAgentTeams).mock.calls.filter(([, , , options]) => options?.method === 'PUT');
    expect(JSON.parse(await updates.at(-1)![0].text()).mcpServers).toEqual([originalServers[1]]);
  });

  it('can revoke and remove a Worker that was already deleted', async () => {
    store.set(key, record());
    vi.mocked(proxyToAgentTeams).mockResolvedValue(NextResponse.json({ error: 'missing' }, { status: 404 }));
    expect(await authorizeManagedMcp(request(), 'docs', [])).toMatchObject({ success: true, authorizedWorkers: [], pendingRemovalWorkers: [] });
    expect(callHigressConsole).toHaveBeenCalledWith('/v1/mcpServer/consumers', expect.objectContaining({ method: 'DELETE', body: { mcpServerName: 'docs', consumers: ['worker-deployed-a'] } }));
    expect(vi.mocked(proxyToAgentTeams).mock.calls.some(([, , , options]) => options?.method === 'PUT')).toBe(false);
  });

  it('restores the original Worker configuration when granting fails', async () => {
    store.set(key, { ...record(), authorizedWorkers: [] });
    vi.mocked(callHigressConsole).mockImplementation(async (path, options) => path === '/v1/mcpServer/consumers' && options?.method === 'PUT' ? { response: new Response(null, { status: 500 }), body: null } : consoleResult());
    expect((await authorizeManagedMcp(request(), 'docs', ['agent-a'])).success).toBe(false);
    const updates = vi.mocked(proxyToAgentTeams).mock.calls.filter(([, , , options]) => options?.method === 'PUT');
    expect(updates).toHaveLength(2);
    expect(JSON.parse(await updates[1][0].text()).mcpServers).toEqual(originalServers);
    expect(store.get(key)?.authorizedWorkers).toEqual([]);
  });

  it.each(['workers', 'managers'])('blocks deletion for a %s reference created outside this panel', async (collection) => {
    store.set(key, { ...record(), authorizedWorkers: [] });
    vi.mocked(proxyToAgentTeams).mockImplementation(async (_request, _base, path) => NextResponse.json({ [path.endsWith('/workers') ? 'workers' : 'managers']: path.endsWith(`/${collection}`) ? [{ name: 'another-agent', mcpServers: originalServers }] : [] }));
    await expect(deleteManagedMcp(request(), 'docs')).rejects.toMatchObject({ status: 409 });
    expect(callHigressConsole).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });

  it('omits connection YAML, tool schemas and individual Worker names from directory summaries', () => {
    const saved = record(); saved.connection.rawConfig = 'headers:\n- value: literal-private-token';
    saved.verification = { success: true, message: 'OK', tools: [{ name: 'private-tool', inputSchema: {} }] };
    const summary = publicMcpRecord(saved, false);
    expect(summary).toMatchObject({ kind: 'proxy', toolCount: 1, authorizedWorkerCount: 1 });
    expect(JSON.stringify(summary)).not.toMatch(/backend-secret|probe-secret|literal-private-token|private-tool|agent-a/);
    expect(summary).not.toHaveProperty('connection');
  });

  it('does not send a cached Console cookie to a different deployment address', async () => {
    vi.stubEnv('AGENTTEAMS_ADMIN_USER', 'test-admin'); vi.stubEnv('AGENTTEAMS_ADMIN_PASSWORD', 'test-password');
    vi.mocked(callHigressConsole)
      .mockResolvedValueOnce({ response: new Response(null, { status: 401 }), body: null })
      .mockResolvedValueOnce({ response: new Response(null, { status: 201, headers: { 'Set-Cookie': '_hi_sess=console-a; HttpOnly' } }), body: null })
      .mockResolvedValueOnce(consoleResult([]))
      .mockResolvedValueOnce(consoleResult([]));
    await mcpCapabilities(request());
    expect(vi.mocked(callHigressConsole).mock.calls[2][1]?.cookie).toBe('_hi_sess=console-a');
    vi.mocked(getHigressConsoleURL).mockReturnValue('http://console-b.test');
    await mcpCapabilities(request());
    expect(vi.mocked(callHigressConsole).mock.calls[3][1]?.cookie).toBeNull();
  });

  it('serializes a connection edit with a concurrent revocation', async () => {
    store.set(key, record());
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const reachedGateway = new Promise<void>((resolve) => { entered = resolve; });
    const fallback = vi.mocked(callHigressConsole).getMockImplementation()!;
    vi.mocked(callHigressConsole).mockImplementation(async (path, options) => {
      if (path === '/v1/mcpServer' && options?.method === 'PUT') { entered(); await blocked; }
      return fallback(path, options);
    });
    const saving = saveManagedMcp(request(), { name: 'docs', connection: record().connection });
    await reachedGateway;
    const revoking = authorizeManagedMcp(request(), 'docs', []);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
    release(); await saving;
    expect((await revoking).success).toBe(true);
    expect(store.get(key)?.authorizedWorkers).toEqual([]);
    expect(store.get(key)?.pendingRemovalWorkers).toEqual([]);
  });

  it('persists revocation intent before the ACL change even if the next storage write fails', async () => {
    store.set(key, record());
    const persist = putObject.getMockImplementation()!;
    let count = 0;
    putObject.mockImplementation(async (...args) => { if (++count === 2) throw new Error('storage offline'); return persist(...args); });
    const result = await authorizeManagedMcp(request(), 'docs', []);
    expect(result).toMatchObject({ success: false, authorizedWorkers: [], pendingRemovalWorkers: ['agent-a'] });
    expect(store.get(key)?.pendingRemovalWorkers).toEqual(['agent-a']);
    await saveManagedMcp(request(), { name: 'docs', connection: record().connection });
    const savedGateway = vi.mocked(callHigressConsole).mock.calls.find(([path, options]) => path === '/v1/mcpServer' && options?.method === 'PUT');
    expect(savedGateway?.[1]?.body).toMatchObject({ consumerAuthInfo: { allowedConsumers: ['probe-docs'] } });
    expect((await authorizeManagedMcp(request(), 'docs', [])).success).toBe(true);
  });

  it('requires removing assignments before changing the transport', async () => {
    store.set(key, record());
    await expect(saveManagedMcp(request(), { name: 'docs', connection: { ...record().connection, transport: 'sse', backendUrl: 'http://backend.test/sse' } })).rejects.toMatchObject({ status: 409 });
    expect(putObject).not.toHaveBeenCalled();
    expect(callHigressConsole).not.toHaveBeenCalled();
  });
});
