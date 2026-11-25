// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { GET } from './route';

let server: Server;
let controllerUrl: string;
const received: Array<{ method: string; url: string }> = [];
let nextResponse: { status: number; body: string } = { status: 200, body: '[]' };

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '' });
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

function makeRequest(path: string) {
  const url = new URL(`http://localhost${path}`);
  url.searchParams.set('controllerUrl', controllerUrl);
  return new NextRequest(url);
}

async function callGet(name: string) {
  return GET(makeRequest(`/api/agentteams/workers/${encodeURIComponent(name)}/mcp`), {
    params: Promise.resolve({ name }),
  });
}

describe('GET /api/agentteams/workers/{name}/mcp', () => {
  it('forwards to the controller and normalizes/sanitizes a 200 array', async () => {
    received.length = 0;
    nextResponse = {
      status: 200,
      body: JSON.stringify([
        {
          key: 'teamharness',
          name: 'Team Harness',
          transport: 'stdio',
          command: '/home/lsw/bin/mcp-server',
          args: ['/root/data'],
          env: { AGENTTEAMS_WORKER_MATRIX_TOKEN: 'matrix-secret' },
          headers: { Authorization: 'Bearer header-secret' },
          url: 'https://user:pass@mcp.example.com/sse',
        },
      ]),
    };

    const res = await callGet('worker-1');
    const body = (await res.json()) as {
      available: boolean;
      worker: string;
      items: Array<Record<string, unknown>>;
    };

    expect(res.status).toBe(200);
    expect(received).toEqual([{ method: 'GET', url: '/api/v1/workers/worker-1/mcp' }]);
    expect(body.available).toBe(true);
    expect(body.worker).toBe('worker-1');
    expect(body.items).toEqual([
      {
        name: 'teamharness',
        displayName: 'Team Harness',
        transport: 'stdio',
        command: '~/bin/mcp-server',
        args: ['~/data'],
        url: 'https://mcp.example.com/sse',
        envKeys: ['AGENTTEAMS_WORKER_MATRIX_TOKEN'],
        headerKeys: ['Authorization'],
      },
    ]);
    // 上游明文凭据绝不下发浏览器。
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('matrix-secret');
    expect(serialized).not.toContain('header-secret');
  });

  it('passes a 404 through unchanged so the client can degrade honestly', async () => {
    received.length = 0;
    nextResponse = { status: 404, body: '{"error":"worker not found"}' };

    const res = await callGet('missing');

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"worker not found"}');
  });

  it('passes a 403 through unchanged', async () => {
    received.length = 0;
    nextResponse = { status: 403, body: '{"error":"forbidden"}' };

    const res = await callGet('worker-1');

    expect(res.status).toBe(403);
    expect(await res.text()).toBe('{"error":"forbidden"}');
  });

  it('rejects an invalid worker name before dialing the controller', async () => {
    received.length = 0;
    nextResponse = { status: 200, body: '[]' };

    const res = await callGet('bad name');

    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });
});
