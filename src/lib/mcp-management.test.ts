import { describe, expect, it } from 'vitest';
import { emptyMcpConnection, mergeMcpSecrets, publicMcpConnection, validateMcpInput } from './mcp-management';

describe('MCP connection validation and credential updates', () => {
  const input = () => ({ name: 'project-docs', connection: { ...emptyMcpConnection(), backendUrl: 'https://mcp.example.com/mcp' } });
  it('separates connection type from transport and rejects non-HTTP endpoints', () => {
    expect(validateMcpInput(input())).toBeUndefined();
    expect(validateMcpInput({ ...input(), connection: { ...input().connection, backendUrl: 'stdio://mcp' } })).toMatch(/HTTP/);
    expect(validateMcpInput({ ...input(), connection: { ...input().connection, backendUrl: 'https://user:password@example.com/mcp' } })).toMatch(/地址/);
  });
  it('rejects a backend query in the URL, ambiguous duplicate headers and reserved credentials', () => {
    expect(validateMcpInput({ ...input(), connection: { ...input().connection, backendUrl: 'https://example.com/mcp?key=secret' } })).toMatch(/Query/);
    expect(validateMcpInput({ ...input(), connection: { ...input().connection, headers: [{ name: 'x-tenant', value: 'a' }, { name: 'X-Tenant', value: 'b' }] } })).toMatch(/重复/);
    expect(validateMcpInput({ ...input(), connection: { ...input().connection, headers: [{ name: 'Authorization', value: 'Bearer key' }] } })).toMatch(/认证/);
  });
  it('requires mapped path variables and rejects duplicate tool parameters', () => {
    const connection = { ...input().connection, kind: 'rest' as const, tools: [{ name: 'get_doc', description: '读取文档', method: 'GET' as const, path: '/docs/{id}', parameters: [] }] };
    expect(validateMcpInput({ ...input(), connection })).toMatch(/id/);
    connection.tools[0].path = '/docs';
    expect(validateMcpInput({ ...input(), connection })).toBeUndefined();
  });
  it('never returns stored secrets; blank edits retain them and deleting rows removes them', () => {
    const previous = { ...input().connection, auth: { type: 'bearer' as const, secret: 'private-token' }, headers: [{ name: 'X-Private', value: 'private-header', secret: true }, { name: 'X-Tenant', value: 'team-a' }] };
    const visible = publicMcpConnection(previous);
    expect(JSON.stringify(visible)).not.toMatch(/private-token|private-header/);
    expect(visible.headers[1].value).toBe('team-a');
    expect(mergeMcpSecrets(visible, previous).auth.secret).toBe('private-token');
    expect(mergeMcpSecrets(visible, previous).headers[0].value).toBe('private-header');
    expect(mergeMcpSecrets({ ...visible, auth: { type: 'none' }, headers: [] }, previous).headers).toEqual([]);
    expect(mergeMcpSecrets({ ...visible, auth: { type: 'none' } }, previous).auth.secret).toBe('');
  });
});
