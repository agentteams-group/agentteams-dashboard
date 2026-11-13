// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { emptyMcpConnection } from '@/lib/mcp-management';
import { GET } from './route';

vi.mock('@/lib/minio-client', () => ({ createMinioClient: vi.fn(), getMinioBucket: vi.fn() }));
const record = { name: 'docs', url: 'http://gateway.test/mcp-servers/docs', transport: 'streaminghttp', managed: true, gatewayState: 'ready',
  connection: { ...emptyMcpConnection(), auth: { type: 'bearer', secret: 'private-token' }, rawConfig: 'tools:\n- name: private-tool\n  credential: private-yaml-value' },
  authorizedWorkers: ['private-worker'], probe: { name: 'private-probe', key: 'private-probe-key' }, verification: { success: true, message: 'OK', tools: [{ name: 'private-tool', inputSchema: {} }] } };
beforeEach(() => {
  vi.mocked(getMinioBucket).mockReturnValue('test-bucket');
  vi.mocked(createMinioClient).mockReturnValue({
    listObjects: () => (async function* () { yield { name: 'mcp-servers/docs.json' }; })(),
    getObject: async () => Readable.from([Buffer.from(JSON.stringify(record))]),
  } as never);
});

it('returns only an assignable service summary for non-administrators', async () => {
  const result = await GET(new NextRequest('http://dashboard.test/api/agentteams/mcps', { headers: { 'x-agentteams-user': 'reader', 'x-agentteams-user-level': '1' } }));
  const text = await result.text();
  expect(result.status).toBe(200);
  expect(JSON.parse(text).servers[0]).toMatchObject({ name: 'docs', kind: 'proxy', toolCount: 1, authorizedWorkerCount: 1 });
  expect(text).not.toMatch(/private-token|private-yaml-value|private-probe|private-worker|private-tool/);
  expect(JSON.parse(text).servers[0]).not.toHaveProperty('connection');
});

it('returns editable connection fields to administrators while masking saved credentials', async () => {
  const result = await GET(new NextRequest('http://dashboard.test/api/agentteams/mcps', { headers: { 'x-agentteams-user': 'admin', 'x-agentteams-user-level': '3' } }));
  const text = await result.text();
  expect(JSON.parse(text).servers[0].connection.auth).toEqual({ type: 'bearer', configured: true });
  expect(text).not.toMatch(/private-token|private-probe-key/);
});
