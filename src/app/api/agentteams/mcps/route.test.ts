// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { emptyMcpConnection } from '@/lib/mcp-management';
import { callControllerAsset } from '@/app/api/higress/controller-helper';
import { GET, POST } from './route';
import { PUT, DELETE } from './[name]/route';

vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/minio-client', () => ({ createMinioClient: vi.fn(), getMinioBucket: vi.fn() }));
vi.mock('@/app/api/higress/controller-helper', () => ({ callControllerAsset: vi.fn() }));
const legacyRecord = { name: 'legacy', url: 'http://gateway.test/mcp-servers/legacy', transport: 'streaminghttp', createdAt: '', updatedAt: '' };
const record = { name: 'docs', url: 'http://gateway.test/mcp-servers/docs', transport: 'streaminghttp', managed: true, gatewayState: 'ready',
  connection: { ...emptyMcpConnection(), auth: { type: 'bearer', secret: 'private-token' }, rawConfig: 'tools:\n- name: private-tool\n  credential: private-yaml-value' },
  authorizedWorkers: ['private-worker'], probe: { name: 'private-probe', key: 'private-probe-key' }, verification: { success: true, message: 'OK', tools: [{ name: 'private-tool', inputSchema: {} }] } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(callControllerAsset).mockResolvedValue(null);
  vi.mocked(getMinioBucket).mockReturnValue('test-bucket');
  vi.mocked(createMinioClient).mockReturnValue({
    listObjects: () => (async function* () { yield { name: 'mcp-servers/docs.json' }; })(),
    getObject: async (_bucket: string, key: string) => {
      const stream = new Readable({ read() {} });
      const stored = key === 'mcp-servers/docs.json' ? record : key === 'mcp-servers/legacy.json' ? legacyRecord : null;
      if (!stored) {
        queueMicrotask(() => stream.destroy(Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' })));
        return stream;
      }
      queueMicrotask(() => { stream.push(Buffer.from(JSON.stringify(stored))); stream.push(null); });
      return stream;
    },
    putObject: vi.fn().mockResolvedValue(undefined),
    removeObject: vi.fn().mockResolvedValue(undefined),
  } as never);
  vi.stubEnv('DASHBOARD_STATELESS', '1');
});
afterEach(() => vi.unstubAllEnvs());

it.each([1, 2, 3])('allows MCP reads and enforces registration RBAC at level %i', async (level) => {
  const headers = { 'x-agentteams-user': `user-${level}`, 'x-agentteams-user-level': String(level) };
  const read = await GET(new NextRequest('http://dashboard.test/api/agentteams/mcps', { headers }));
  expect(read.status).toBe(200);
  const write = await POST(new NextRequest('http://dashboard.test/api/agentteams/mcps', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `new-${level}`, url: 'http://gateway.test/mcp', transport: 'streaminghttp' }),
  }));
  expect(write.status).toBe(level === 3 ? 201 : 403);
  if (level < 3) expect(await write.json()).toMatchObject({ action: 'create', resourceType: 'mcp' });
});

it.each([1, 2, 3])('enforces MCP edit and delete RBAC at level %i', async (level) => {
  const headers = { 'x-agentteams-user': `user-${level}`, 'x-agentteams-user-level': String(level), 'content-type': 'application/json' };
  const context = { params: Promise.resolve({ name: 'legacy' }) };
  const edit = await PUT(new NextRequest('http://dashboard.test/api/agentteams/mcps/legacy', {
    method: 'PUT', headers, body: JSON.stringify({ description: 'edited' }),
  }), context);
  expect(edit.status).toBe(level === 3 ? 200 : 403);
  const remove = await DELETE(new NextRequest('http://dashboard.test/api/agentteams/mcps/legacy', {
    method: 'DELETE', headers,
  }), context);
  expect(remove.status).toBe(level === 3 ? 200 : 403);
});

it('returns only an assignable service summary for non-administrators', async () => {
  const result = await GET(new NextRequest('http://dashboard.test/api/agentteams/mcps', { headers: { 'x-agentteams-user': 'reader', 'x-agentteams-user-level': '1' } }));
  const text = await result.text();
  expect(result.status).toBe(200);
  expect(JSON.parse(text).servers[0]).toMatchObject({ name: 'docs', kind: 'proxy', toolCount: 1, authorizedWorkerCount: 1 });
  expect(text).not.toMatch(/private-token|private-yaml-value|private-probe|private-worker|private-tool/);
  expect(JSON.parse(text).servers[0]).not.toHaveProperty('connection');
  expect(callControllerAsset).not.toHaveBeenCalled();
});

it('returns editable connection fields to administrators while masking saved credentials', async () => {
  const result = await GET(new NextRequest('http://dashboard.test/api/agentteams/mcps', { headers: { 'x-agentteams-user': 'admin', 'x-agentteams-user-level': '3' } }));
  const text = await result.text();
  expect(JSON.parse(text).servers[0].connection.auth).toEqual({ type: 'bearer', configured: true });
  expect(text).not.toMatch(/private-token|private-probe-key/);
});

const adminRequest = () => new NextRequest('http://dashboard.test/api/agentteams/mcps', {
  headers: { 'x-agentteams-user': 'admin', 'x-agentteams-user-level': '3' },
});

it('lists Controller-managed MCPs without requiring Dashboard MinIO configuration', async () => {
  const body = { servers: [{ name: 'saved-mcp', managed: true, toolCount: 26 }] };
  vi.mocked(getMinioBucket).mockReturnValue(null);
  vi.mocked(callControllerAsset).mockResolvedValue({ response: Response.json(body), body });
  const request = adminRequest();

  const result = await GET(request);

  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(body);
  expect(callControllerAsset).toHaveBeenCalledWith(request, 'mcps', { action: 'list' });
  expect(getMinioBucket).not.toHaveBeenCalled();
  expect(createMinioClient).not.toHaveBeenCalled();
});

it('keeps an empty Controller directory authoritative over stale MinIO records', async () => {
  const body = { servers: [] };
  vi.mocked(callControllerAsset).mockResolvedValue({ response: Response.json(body), body });

  const result = await GET(adminRequest());

  expect(await result.json()).toEqual(body);
  expect(createMinioClient).not.toHaveBeenCalled();
});

it.each([401, 403, 502, 503])('preserves Controller HTTP %i instead of returning legacy records', async (status) => {
  const body = { error: 'Controller request failed' };
  vi.mocked(callControllerAsset).mockResolvedValue({ response: Response.json(body, { status }), body });

  const result = await GET(adminRequest());

  expect(result.status).toBe(status);
  expect(await result.json()).toEqual(body);
  expect(createMinioClient).not.toHaveBeenCalled();
});
