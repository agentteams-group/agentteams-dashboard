// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn() }));

let server: Server;
let controllerUrl: string;
const received: Array<{ method: string; url: string; body: string }> = [];
let responseStatus = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', body });
      res.writeHead(responseStatus, { 'content-type': 'application/json', etag: '"worker-v2"' });
      res.end(JSON.stringify(responseStatus === 200
        ? { name: 'worker-1', skills: ['existing', 'new-skill'] }
        : { error: 'unsupported' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  controllerUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const workerAdminHeaders = {
  'content-type': 'application/json',
  'x-agentteams-user': 'worker-admin',
  'x-agentteams-user-level': '3',
  'x-agentteams-scope': 'scoped',
  'x-agentteams-workers': JSON.stringify(['worker-1']),
};

function makeRequest(body: string, headers: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/agentteams/workers/worker-1/skills/append');
  url.searchParams.set('controllerUrl', controllerUrl);
  return new NextRequest(url, {
    method: 'POST',
    headers: { ...workerAdminHeaders, ...headers },
    body,
  });
}

beforeEach(() => {
  received.length = 0;
  responseStatus = 200;
});

describe('POST /api/agentteams/workers/{name}/skills/append', () => {
  it('proxies the atomic append contract and passes through the ETag', async () => {
    const res = await POST(makeRequest(JSON.stringify({ skillName: 'new-skill' })), {
      params: Promise.resolve({ name: 'worker-1' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"worker-v2"');
    expect(received).toEqual([{
      method: 'POST',
      url: '/api/v1/workers/worker-1/skills/append',
      body: JSON.stringify({ skillName: 'new-skill' }),
    }]);
  });

  it('preserves a controller 404/405 so the client can use its ETag fallback', async () => {
    responseStatus = 405;
    const res = await POST(makeRequest(JSON.stringify({ skillName: 'new-skill' })), {
      params: Promise.resolve({ name: 'worker-1' }),
    });
    expect(res.status).toBe(405);
    expect(received).toHaveLength(1);
  });

  it('denies an observer before reaching the controller', async () => {
    const res = await POST(makeRequest(JSON.stringify({ skillName: 'new-skill' }), {
      'x-agentteams-user': 'observer',
      'x-agentteams-user-level': '1',
    }), { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(403);
    expect(received).toHaveLength(0);
  });

  it.each<[string, Record<string, string>, number]>([
    ['missing identity', { 'x-agentteams-user': '' }, 401],
    ['unknown scope', {
      'x-agentteams-user': 'user',
      'x-agentteams-user-level': '1',
      'x-agentteams-scope': 'unknown',
    }, 403],
    ['cross-resource scope', {
      ...workerAdminHeaders,
      'x-agentteams-workers': JSON.stringify(['other']),
    }, 403],
  ])('denies %s before reaching the controller', async (_label, headers, status) => {
    const res = await POST(makeRequest(JSON.stringify({ skillName: 'new-skill' }), headers), {
      params: Promise.resolve({ name: 'worker-1' }),
    });
    expect(res.status).toBe(status);
    expect(received).toHaveLength(0);
  });

  it('rejects an invalid worker name before authentication or proxying', async () => {
    const res = await POST(makeRequest(JSON.stringify({ skillName: 'new-skill' }), {
      'x-agentteams-user': '',
    }), { params: Promise.resolve({ name: 'worker one' }) });
    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });
});
