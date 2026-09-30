// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest, NextResponse } from 'next/server';

const rbacMock = vi.fn<
  (_request: NextRequest, _action: string, _resource: string, _name: string) => Promise<NextResponse | null>
>();
vi.mock('@/lib/server-auth', () => ({
  enforceLevelOnlyRbac: (_request: NextRequest, _action: string, _resource: string, _name: string) =>
    rbacMock(_request, _action, _resource, _name),
}));

import { POST } from './route';

let server: Server;
let baseUrl: string;

type Handler = (_req: import("node:http").IncomingMessage, _res: import("node:http").ServerResponse) => void;

let handler: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test-mcp' } } }));
};

const receivedRequests: { method?: string; url?: string; auth?: string; body?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      receivedRequests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf-8'),
      });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  baseUrl = `http://127.0.0.1:${address.port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  receivedRequests.length = 0;
  rbacMock.mockClear();
});

function testRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/agentteams/mcps/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postJson(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await POST(testRequest(body));
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe('POST /api/agentteams/mcps/test', () => {
  it('completes the initialize handshake against a streamable-HTTP endpoint', async () => {
    const { status, json } = await postJson({
      url: baseUrl,
      transport: 'streaminghttp',
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('test-mcp');
    expect(json.statusCode).toBe(200);
    expect(typeof json.latencyMs).toBe('number');

    const forwarded = receivedRequests[0];
    expect(forwarded.method).toBe('POST');
    expect(forwarded.auth).toBe('Bearer secret-token');
    expect(JSON.parse(forwarded.body ?? '{}')).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
  });

  it('parses an SSE-framed initialize response', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","serverInfo":{"name":"sse-mcp"}}}\n\n'
      );
    };
    const { json } = await postJson({
      url: baseUrl,
      transport: 'streaminghttp',
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(json.success).toBe(true);
    expect(json.message).toContain('sse-mcp');
  });

  it('reports auth failures with an actionable message', async () => {
    handler = (_req, res) => {
      res.writeHead(401);
      res.end();
    };
    const { status, json } = await postJson({ url: baseUrl, transport: 'streaminghttp' });
    expect(status).toBe(200);
    expect(json.success).toBe(false);
    expect(json.message).toContain('鉴权失败 (401)');
    expect(json.statusCode).toBe(401);
  });

  it('maps 405 to a transport mismatch hint', async () => {
    handler = (_req, res) => {
      res.writeHead(405);
      res.end();
    };
    const { json } = await postJson({ url: baseUrl, transport: 'streaminghttp' });
    expect(json.success).toBe(false);
    expect(json.message).toContain('transport');
  });

  it('opens the GET stream for legacy sse transport', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\n\n');
      // Keep the stream open briefly; the client reads the first frame.
    };
    const { json } = await postJson({ url: baseUrl, transport: 'sse' });
    expect(json.success).toBe(true);
    expect(receivedRequests[0].method).toBe('GET');
  });

  it('fails fast when the handshake payload is not MCP JSON-RPC', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>not mcp</html>');
    };
    const { json } = await postJson({ url: baseUrl, transport: 'streaminghttp' });
    expect(json.success).toBe(false);
    expect(json.message).toContain('握手失败');
  });

  it('reports a timeout instead of hanging', async () => {
    handler = (_req, res) => {
      // Never respond; the client aborts after the timeout.
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, 2_000);
    };
    const { json } = await postJson({ url: baseUrl, transport: 'streaminghttp', timeout: 200 });
    expect(json.success).toBe(false);
    expect(json.message).toContain('超时');
  });

  it('rejects non-http URLs without hitting the network', async () => {
    const { status, json } = await postJson({ url: 'ftp://example.com/mcp', transport: 'streaminghttp' });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.message).toContain('地址不合法');
    expect(receivedRequests).toHaveLength(0);
  });

  it('denies access when RBAC rejects the caller', async () => {
    rbacMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'forbidden' }, { status: 403 })
    );
    const response = await POST(testRequest({ url: baseUrl, transport: 'streaminghttp' }));
    expect(response.status).toBe(403);
    expect(receivedRequests).toHaveLength(0);
  });
});
