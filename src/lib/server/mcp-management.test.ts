// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { compileRestConfig, publicMcpRecord } from './mcp-management';
import { verifyManagedMcp } from './mcp-management';
import { emptyMcpConnection } from '@/lib/mcp-management';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import * as client from './mcp-client';

vi.mock('@/lib/minio-client', () => ({ createMinioClient: vi.fn(), getMinioBucket: vi.fn() }));

describe('Higress REST-to-MCP compiler', () => {
  it('maps Path, Query, Header and JSON Body without sharing arguments between tools', () => {
    const config = parse(compileRestConfig({ name: 'docs', connection: { ...emptyMcpConnection(), kind: 'rest', backendUrl: 'https://api.example.com/v1', auth: { type: 'bearer', secret: 'backend-token' }, headers: [{ name: 'X-Tenant-Id', value: 'team-a' }], query: [{ name: 'region', value: 'cn hangzhou' }], tools: [
      { name: 'update_doc', description: '更新文档', method: 'POST', path: '/docs/{id}', parameters: [
        { name: 'id', type: 'string', position: 'path', required: true },
        { name: 'search', type: 'string', position: 'query', required: false },
        { name: 'X-Version', type: 'string', position: 'header', required: true },
        { name: 'document', type: 'object', position: 'body', required: true },
      ] }, { name: 'list_docs', description: '文档列表', method: 'GET', path: '/docs', parameters: [] },
    ] } }));
    const request = config.tools[0].requestTemplate;
    expect(request.url).toContain('/v1/docs/{id}');
    expect(request.url).toContain('region=cn+hangzhou');
    expect(config.tools[0].args.map((p: { position: string }) => p.position)).toEqual(['path', 'query', 'header', 'body']);
    expect(request.headers).toEqual(expect.arrayContaining([{ key: 'Authorization', value: 'Bearer backend-token' }, { key: 'X-Tenant-Id', value: 'team-a' }]));
    expect(request.argsToJsonBody).toBe(true);
    expect(config.tools[1].requestTemplate.url).not.toContain('search');
  });
  it('applies shared backend credentials to imported tools and rejects unrelated origins', () => {
    const connection = { ...emptyMcpConnection(), kind: 'rest' as const, backendUrl: 'https://api.example.com', auth: { type: 'api-key' as const, name: 'key', in: 'query' as const, secret: 'token&value' }, rawConfig: 'tools:\n- name: get_docs\n  args: []\n  requestTemplate:\n    method: GET\n    url: https://api.example.com/docs\n' };
    expect(parse(compileRestConfig({ name: 'docs', connection })).tools[0].requestTemplate.url).toContain('key=token%26value');
    expect(() => compileRestConfig({ name: 'docs', connection: { ...connection, rawConfig: connection.rawConfig.replace('https://api.example.com/docs', 'https://other.example.com/docs') } })).toThrow(/必须属于/);
  });
  it('does not expose the internal gateway probe credential', () => {
    const record = { name: 'docs', managed: true as const, connection: emptyMcpConnection(), description: '', url: 'https://gateway/mcp-servers/docs', transport: 'streaminghttp' as const, createdAt: '', updatedAt: '', gatewayState: 'ready' as const, authorizedWorkers: [], probe: { name: 'probe', key: 'private-probe-key' } };
    expect(JSON.stringify(publicMcpRecord(record))).not.toContain('private-probe-key');
  });

  it('masks punctuation credentials without corrupting the result object', async () => {
    const record = { name: 'docs', managed: true, connection: { ...emptyMcpConnection(), headers: [{ name: 'X-Private', value: '{', secret: true }] }, url: 'http://gateway/mcp-servers/docs', transport: 'streaminghttp', gatewayState: 'ready', authorizedWorkers: [], probe: { name: 'probe', key: 'private-key' } };
    vi.mocked(getMinioBucket).mockReturnValue('test-bucket');
    vi.mocked(createMinioClient).mockReturnValue({ getObject: vi.fn(async () => (async function* () { yield Buffer.from(JSON.stringify(record)); })()), putObject: vi.fn().mockResolvedValue({}) } as never);
    const spy = vi.spyOn(client, 'withMcpClient').mockResolvedValue({ tools: [], result: { content: [{ type: 'text', text: 'value: {' }], count: 2 } });
    const result = await verifyManagedMcp('docs', 'inspect', {});
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ content: [{ type: 'text', text: 'value: ••••••' }], count: 2 });
    spy.mockRestore();
  });
});
