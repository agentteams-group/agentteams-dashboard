// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { GET, PUT, DELETE } from './route';

let server: Server;
let controllerUrl: string;
const received: Array<{ method: string; url: string; body?: string }> = [];
let nextResponse: { status: number; body: string } = { status: 200, body: '{"name":"worker-1","spec":{"skills":["s1"]}}' };

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', body });
      res.writeHead(nextResponse.status, { 'content-type': 'application/json' });
      res.end(nextResponse.body);
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

function makeRequest(path: string, init: { method?: string; body?: string } = {}) {
  // Pass the controller URL via the same `controllerUrl` query the proxy-helper
  // recognises, so this test does not need a real AgentTeams controller.
  const url = new URL(`http://localhost${path}`);
  url.searchParams.set('controllerUrl', controllerUrl);
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body,
  });
}

describe('GET /api/agentteams/workers/{name}', () => {
  it('forwards the GET to the controller with the canonical /api/v1/workers/{name} path', async () => {
    received.length = 0;
    const res = await GET(makeRequest('/api/agentteams/workers/worker-1'), {
      params: Promise.resolve({ name: 'worker-1' }),
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('GET');
    expect(received[0].url.startsWith('/api/v1/workers/worker-1')).toBe(true);
  });

  it('percent-encodes the worker name segment', async () => {
    received.length = 0;
    const res = await GET(makeRequest('/api/agentteams/workers/worker%20one'), {
      params: Promise.resolve({ name: 'worker one' }),
    });

    expect(res.status).toBe(200);
    expect(received[0].url).toBe('/api/v1/workers/worker%20one');
  });

  it('does not forward a body for GET (forwardBody:false)', async () => {
    received.length = 0;
    const res = await GET(makeRequest('/api/agentteams/workers/worker-1'), {
      params: Promise.resolve({ name: 'worker-1' }),
    });

    expect(res.status).toBe(200);
    // The Next.js request has no body; the proxy must not synthesise one.
    expect(received[0].body).toBe('');
  });

  it('passes through a non-OK controller response (e.g. 404) so callers can distinguish it from a 405', async () => {
    received.length = 0;
    nextResponse = { status: 404, body: '{"error":"worker not found"}' };

    const res = await GET(makeRequest('/api/agentteams/workers/missing'), {
      params: Promise.resolve({ name: 'missing' }),
    });

    expect(res.status).toBe(404);

    // Restore the default handler for subsequent tests.
    nextResponse = { status: 200, body: '{"name":"worker-1","spec":{"skills":["s1"]}}' };
  });
});

describe('PUT /api/agentteams/workers/{name} (smoke)', () => {
  it('forwards PUT to the controller', async () => {
    received.length = 0;
    const res = await PUT(
      makeRequest('/api/agentteams/workers/worker-1', {
        method: 'PUT',
        body: JSON.stringify({ spec: { skills: ['s1', 's2'] } }),
      }),
      { params: Promise.resolve({ name: 'worker-1' }) },
    );

    expect(res.status).toBe(200);
    expect(received[0].method).toBe('PUT');
    expect(received[0].url).toBe('/api/v1/workers/worker-1');
    expect(received[0].body).toBe(JSON.stringify({ spec: { skills: ['s1', 's2'] } }));
  });
});

describe('DELETE /api/agentteams/workers/{name} (smoke)', () => {
  it('forwards DELETE to the controller', async () => {
    received.length = 0;
    const res = await DELETE(makeRequest('/api/agentteams/workers/worker-1', { method: 'DELETE' }), {
      params: Promise.resolve({ name: 'worker-1' }),
    });

    expect(res.status).toBe(200);
    expect(received[0].method).toBe('DELETE');
    expect(received[0].url).toBe('/api/v1/workers/worker-1');
  });
});

describe('RBAC enforcement on worker write routes', () => {
  function makeRequestWithLevel(name: string, level: number) {
    const url = new URL(`http://localhost/api/agentteams/workers/worker-1`);
    url.searchParams.set('controllerUrl', controllerUrl);
    const headers: Record<string, string> = {
      'x-agentteams-user': name,
      'x-agentteams-user-level': String(level),
    };
    return new NextRequest(url, { method: 'DELETE', headers });
  }

  it('denies observer DELETE on a worker (403)', async () => {
    received.length = 0;
    const res = await DELETE(makeRequestWithLevel('observer', 1), {
      params: Promise.resolve({ name: 'worker-1' }),
    });
    expect(res.status).toBe(403);
    expect(received).toHaveLength(0);
  });

  it('denies observer PUT on a worker (403)', async () => {
    received.length = 0;
    const url = new URL(`http://localhost/api/agentteams/workers/worker-1`);
    url.searchParams.set('controllerUrl', controllerUrl);
    const req = new NextRequest(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-agentteams-user': 'observer',
        'x-agentteams-user-level': '1',
      },
      body: JSON.stringify({ spec: { skills: [] } }),
    });
    const res = await PUT(req, { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(403);
    expect(received).toHaveLength(0);
  });

  it('allows admin DELETE on a worker', async () => {
    received.length = 0;
    const res = await DELETE(makeRequestWithLevel('admin', 3), {
      params: Promise.resolve({ name: 'worker-1' }),
    });
    expect(res.status).toBe(200);
    expect(received[0].method).toBe('DELETE');
  });
});
