import { describe, expect, it } from 'vitest';
import {
  mergeWorkerMcpRows,
  normalizeWorkerMcpItems,
  redactMcpUrl,
  tildeMcpPath,
  workerMcpEndpoint,
  workerMcpTransport,
} from './worker-mcp';

describe('normalizeWorkerMcpItems', () => {
  it('keeps only env/header key names and never leaks values', () => {
    const items = normalizeWorkerMcpItems([
      {
        key: 'teamharness',
        name: 'Team Harness',
        enabled: true,
        transport: 'stdio',
        command: '/home/lsw/bin/mcp-server',
        args: ['/root/data', '--flag'],
        env: { AGENTTEAMS_WORKER_MATRIX_TOKEN: 'matrix-secret', PLAIN: 'value' },
        headers: { Authorization: 'Bearer header-secret' },
        url: 'https://user:pass@mcp.example.com/sse',
      },
    ]);

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.name).toBe('teamharness');
    expect(item.displayName).toBe('Team Harness');
    expect(item.enabled).toBe(true);
    expect(item.transport).toBe('stdio');
    expect(item.command).toBe('~/bin/mcp-server');
    expect(item.args).toEqual(['~/data', '--flag']);
    expect(item.envKeys).toEqual(['AGENTTEAMS_WORKER_MATRIX_TOKEN', 'PLAIN']);
    expect(item.headerKeys).toEqual(['Authorization']);
    expect(item.url).toBe('https://mcp.example.com/sse');

    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('matrix-secret');
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('pass@');
  });

  it('accepts envelope objects and name-to-config maps', () => {
    expect(
      normalizeWorkerMcpItems({ mcpServers: [{ name: 'ctx7', url: 'http://mcp' }] }).map((i) => i.name),
    ).toEqual(['ctx7']);
    expect(
      normalizeWorkerMcpItems({ items: [{ key: 'workerflow', transport: 'http' }] }).map((i) => i.name),
    ).toEqual(['workerflow']);
    const fromMap = normalizeWorkerMcpItems({
      teamharness: { type: 'stdio', command: '/root/tool' },
    });
    expect(fromMap).toEqual([
      { name: 'teamharness', transport: 'stdio', command: '~/tool' },
    ]);
  });

  it('falls back to name/id/server for identity and skips unusable entries', () => {
    expect(
      normalizeWorkerMcpItems([
        { id: 'by-id' },
        { server: 'by-server' },
        { name: '   ' },
        'not-an-object',
        null,
      ]).map((item) => item.name),
    ).toEqual(['by-id', 'by-server']);
  });
});

describe('mergeWorkerMcpRows', () => {
  it('merges by name and keeps both sources on one row', () => {
    const rows = mergeWorkerMcpRows(
      [
        { name: 'ctx7', url: 'http://declared.example/mcp', transport: 'http' },
        { name: 'declared-only', url: 'http://declared-only.example/mcp', transport: 'sse' },
      ],
      [
        { name: 'ctx7', url: 'https://self.example/sse', transport: 'sse' },
        { name: 'teamharness', url: 'http://teamharness.example/mcp', transport: 'http' },
      ],
    );

    expect(rows.map((row) => row.name)).toEqual(['ctx7', 'declared-only', 'teamharness']);
    const ctx7 = rows[0];
    expect(ctx7.declared?.url).toBe('http://declared.example/mcp');
    expect(ctx7.self?.url).toBe('https://self.example/sse');
    // 字段冲突自注册优先（运行时注册是真相）。
    expect(workerMcpEndpoint(ctx7)).toBe('https://self.example/sse');
    expect(workerMcpTransport(ctx7)).toBe('sse');
    // 单来源行仍保留自己那一路。
    expect(rows[1].self).toBeUndefined();
    expect(rows[2].declared).toBeUndefined();
  });

  it('returns an empty list for missing/empty inputs', () => {
    expect(mergeWorkerMcpRows(undefined, undefined)).toEqual([]);
    expect(mergeWorkerMcpRows([], [])).toEqual([]);
  });
});

describe('redaction helpers', () => {
  it('tilde-ifies home paths and strips url userinfo only when present', () => {
    expect(tildeMcpPath('/home/alice/bin/tool')).toBe('~/bin/tool');
    expect(tildeMcpPath('/root')).toBe('~');
    expect(tildeMcpPath('/opt/tool')).toBe('/opt/tool');
    expect(redactMcpUrl('https://user:pass@mcp.example.com/sse')).toBe('https://mcp.example.com/sse');
    expect(redactMcpUrl('https://mcp.example.com/sse')).toBe('https://mcp.example.com/sse');
  });
});
