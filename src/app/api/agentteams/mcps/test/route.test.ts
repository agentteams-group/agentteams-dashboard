// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';

vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn().mockResolvedValue(undefined) }));

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
  vi.unstubAllEnvs();
});

function testRequest(body: unknown, level = 1): NextRequest {
  return new NextRequest('http://localhost:3000/api/agentteams/mcps/test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agentteams-user': `user-${level}`,
      'x-agentteams-user-level': String(level),
    },
    body: JSON.stringify(body),
  });
}

async function postJson(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await POST(testRequest(body));
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe('POST /api/agentteams/mcps/test', () => {
  beforeEach(() => vi.stubEnv('DASHBOARD_STATELESS', '1'));

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

  it('initializes legacy SSE through its advertised message endpoint with credentials', async () => {
    let stream: import('node:http').ServerResponse;
    handler = (req, res) => {
      if (req.method === 'GET') {
        stream = res;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: endpoint\ndata: /messages?session_id=test\n\n');
        return;
      }
      const body = JSON.parse(receivedRequests.at(-1)!.body!);
      res.writeHead(202); res.end();
      if (body.method === 'initialize') stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'legacy-sse' } } })}\n\n`);
    };
    const { json } = await postJson({ url: baseUrl, transport: 'sse', headers: { Authorization: 'Bearer backend-token' }, timeout: 500 });
    expect(json.success).toBe(true);
    expect(receivedRequests.map((req) => req.method)).toEqual(['GET', 'POST', 'POST']);
    expect(receivedRequests.every((req) => req.auth === 'Bearer backend-token')).toBe(true);
    expect(receivedRequests[1].url).toBe('/messages?session_id=test');
    expect(JSON.parse(receivedRequests[2].body!).method).toBe('notifications/initialized');
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

  it.each([1, 2, 3])('allows MCP connection tests at level %i', async (level) => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test-mcp' } } }));
    };
    const response = await POST(testRequest({ url: baseUrl, transport: 'streaminghttp' }, level));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(receivedRequests).toHaveLength(1);
  });
});
