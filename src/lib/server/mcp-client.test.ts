// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMcpTools, withMcpClient } from './mcp-client';

afterEach(() => vi.unstubAllGlobals());

describe('MCP initialization, discovery and calls', () => {
  it('keeps negotiated session headers, paginates tools, and never calls a tool during discovery', async () => {
    const calls: { method: string; headers: HeadersInit | undefined }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      calls.push({ method: body.method, headers: options.headers });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26', serverInfo: { name: 'docs' } } : body.params?.cursor ? { tools: [{ name: 'second', inputSchema: {} }] } : { tools: [{ name: 'first', inputSchema: {} }], nextCursor: 'next' };
      return Response.json({ jsonrpc: '2.0', id: body.id, result }, { headers: { 'Mcp-Session-Id': 'session-123' } });
    }));
    const result = await withMcpClient('https://example.com/mcp', 'streaminghttp', { Authorization: 'Bearer gateway-token' }, 1000, listMcpTools);
    expect(result.map((t) => t.name)).toEqual(['first', 'second']);
    expect(calls.map((c) => c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
    expect(new Headers(calls[2].headers).get('Mcp-Session-Id')).toBe('session-123');
    expect(new Headers(calls[2].headers).get('Authorization')).toBe('Bearer gateway-token');
  });
  it('reads fragmented SSE responses and matches JSON-RPC IDs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26', serverInfo: { name: 'docs' } } : { tools: [] };
      const raw = `: heartbeat\r\n\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\r\n\r\n`;
      return new Response(new ReadableStream({ start(controller) { for (const char of raw) controller.enqueue(new TextEncoder().encode(char)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await expect(withMcpClient('https://example.com/mcp', 'streaminghttp', {}, 1000, listMcpTools)).resolves.toEqual([]);
  });
  it('rejects HTTP authorization errors and cross-origin SSE endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(withMcpClient('https://example.com/mcp', 'streaminghttp', {}, 1000, listMcpTools)).rejects.toThrow(/403/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('event: endpoint\ndata: https://other.example.com/messages\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
    await expect(withMcpClient('https://example.com/sse', 'sse', { Authorization: 'secret' }, 1000, listMcpTools)).rejects.toThrow(/同源/);
  });
});
