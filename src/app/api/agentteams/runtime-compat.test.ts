// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { GET, PUT } from './workers/[name]/runtime-config/route';
import * as humanRoute from './humans/[name]/route';

vi.mock('@/lib/server-auth', async (original) => ({
  ...await original<typeof import('@/lib/server-auth')>(),
  enforceServerSideRbac: vi.fn(async () => null),
}));

let server: Server;
let base: string;
let ifMatch: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/api/v1/humans/alice') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'alice', initialPassword: 'owned-detail-fixture' }));
      return;
    }
    if (req.method === 'PUT') ifMatch = req.headers['if-match'] as string | undefined;
    res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"config-v1"' });
    res.end('{"max_iters":20}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

it('forwards the runtime GET ETag and exact PUT If-Match', async () => {
  const url = `http://localhost/api/agentteams/workers/w1/runtime-config?controllerUrl=${encodeURIComponent(base)}`;
  const params = { params: Promise.resolve({ name: 'w1' }) };
  const read = await GET(new NextRequest(url), params);
  expect(read.headers.get('ETag')).toBe('"config-v1"');
  const write = await PUT(new NextRequest(url, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"config-v1"' }, body: '{"max_iters":25}',
  }), params);
  expect(write.status).toBe(200);
  expect(ifMatch).toBe('"config-v1"');
  expect(write.headers.get('ETag')).toBe('"config-v1"');
});

it('provides the individual Human GET instead of relying on list credentials', async () => {
  const url = `http://localhost/api/agentteams/humans/alice?controllerUrl=${encodeURIComponent(base)}`;
  const response = await humanRoute.GET(new NextRequest(url), { params: Promise.resolve({ name: 'alice' }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ name: 'alice', initialPassword: 'owned-detail-fixture' });
});
