// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { GET } from './workers/route';
import { proxyToAgentTeams } from './proxy-helper';
import { filterEnvironmentResponse } from './workers/environment-access';

let server: Server, target: string;
let received: { url?: string; validator?: string }[];
let denied = false;
let emitETag = true;
const request = (tag = '', name = 'admin', level = '3') => new NextRequest(`http://dashboard/api/agentteams/workers?fields=spec&controllerUrl=${encodeURIComponent(target)}`, {
  headers: { 'x-agentteams-user': name, 'x-agentteams-user-level': level, ...(tag ? { 'If-None-Match': tag } : {}) },
});

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({ url: req.url, validator: req.headers['if-none-match'] });
    if (denied) { res.writeHead(403, { 'content-type': 'application/json' });res.end('{}');return; }
    if (emitETag && req.headers['if-none-match'] === '"upstream-v1"') {
      res.writeHead(304, { ETag: '"upstream-v1"' });res.end();return;
    }
    res.writeHead(200, { 'content-type': 'application/json', ...(emitETag ? { ETag: '"upstream-v1"' } : {}) });
    res.end('{"workers":[{"name":"a","env":{"SECRET":"test-only"}}]}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('missing fixture address');
  target = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { received = [];denied = false;emitETag = true;vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'fixture-token'); });
afterEach(() => vi.unstubAllEnvs());

describe('Worker route and real HTTP proxy validators', () => {
  it('forwards the projection and round-trips an opaque ETag into bodyless 304', async () => {
    const first = await GET(request());expect(first.status).toBe(200);
    const tag = first.headers.get('ETag')!;expect(tag).toMatch(/^W\//);expect(tag).not.toBe('"upstream-v1"');
    expect(received[0].url).toBe('/api/v1/workers?fields=spec');
    const second = await GET(request(tag));expect(second.status).toBe(304);expect(await second.text()).toBe('');
    expect(received[1].validator).toBe('"upstream-v1"');expect(second.headers.get('ETag')).toBe(tag);
  });

  it('rejects validator replay across effective identities, levels, credentials and targets', async () => {
    const tag = (await GET(request())).headers.get('ETag')!;
    for (const req of [request(tag, 'other'), request(tag, 'admin', '1')]) {
      const response = await proxyToAgentTeams(req, target, '/api/v1/workers?fields=spec', { forwardBody: false });
      expect(response.status).toBe(200);expect(received.at(-1)?.validator).toBeUndefined();
    }
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'rotated-fixture-token');
    expect((await GET(request(tag))).status).toBe(200);expect(received.at(-1)?.validator).toBeUndefined();
    const changedTarget = target.replace('127.0.0.1', 'localhost');
    expect((await proxyToAgentTeams(request(tag), changedTarget, '/api/v1/workers?fields=spec', { forwardBody: false })).status).toBe(200);
    expect(received.at(-1)?.validator).toBeUndefined();
  });

  it('preserves the validator through env redaction without leaking env to a lower-level reader', async () => {
    const req = request('', 'operator', '2');
    const response = await filterEnvironmentResponse(req, await proxyToAgentTeams(req, target, '/api/v1/workers?fields=spec', { forwardBody: false }));
    expect((await response.json()).workers[0]).toEqual({ name: 'a', envEditable: false });
    expect(response.headers.get('ETag')).toMatch(/^W\//);
  });

  it('honors permission failures and leaves old Controllers and live status unvalidated', async () => {
    const tag = (await GET(request())).headers.get('ETag')!;denied = true;
    expect((await GET(request(tag))).status).toBe(403);
    denied = false;emitETag = false;
    const old = await GET(request(tag));expect(old.status).toBe(200);expect(old.headers.has('ETag')).toBe(false);
    emitETag = true;
    const status = await proxyToAgentTeams(request(tag), target, '/api/v1/workers?fields=status', { forwardBody: false });
    expect(status.status).toBe(200);expect(status.headers.has('ETag')).toBe(false);expect(received.at(-1)?.validator).toBeUndefined();
  });

  it('redacts old array-shaped full responses too', async () => {
    const response = await filterEnvironmentResponse(request('', 'reader', '1'), Response.json([{ name: 'a', env: { SECRET: 'test-only' } }]));
    expect(await response.json()).toEqual([{ name: 'a', envEditable: false }]);
  });
});
